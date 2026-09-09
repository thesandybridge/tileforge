use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use redis::AsyncCommands;
use tileforge_shared::{progress_key, upload_s3_key, TileJob, NATS_JOBS_SUBJECT, REDIS_JOBS_KEY};
use uuid::Uuid;

use crate::{
    auth::{parse_user_id, Claims},
    error::ApiError,
    state::{require_bucket, require_db, AppState, QUOTA_PRO_BYTES},
};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct JobRow {
    id: Uuid,
    status: String,
    file_name: Option<String>,
    parameters: serde_json::Value,
    progress: i32,
    tiles_done: Option<i64>,
    tiles_total: Option<i64>,
    error: Option<String>,
    retry_count: i32,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    completed_at: Option<chrono::DateTime<chrono::Utc>>,
    cancelled_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn cancel_job(
    State(state): State<AppState>,
    Claims(user): Claims,
    Path(job_id): Path<Uuid>,
) -> Result<Json<JobRow>, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;
    let changed = sqlx::query(
        "UPDATE jobs SET status = 'cancelled', error = NULL, cancelled_at = now(), updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'processing')",
    )
    .bind(job_id).bind(user_id).execute(&db).await
    .map_err(|error| ApiError::Db(error.to_string()))?;
    if changed.rows_affected() == 0 {
        let exists: Option<(String,)> = sqlx::query_as("SELECT status FROM jobs WHERE id = $1 AND user_id = $2")
            .bind(job_id).bind(user_id).fetch_optional(&db).await
            .map_err(|error| ApiError::Db(error.to_string()))?;
        return match exists {
            None => Err(ApiError::NotFound),
            Some(_) => Err(ApiError::Conflict("only queued or processing jobs can be cancelled".into())),
        };
    }
    sqlx::query("SELECT release_job_storage_reservation($1)").bind(job_id).execute(&db).await
        .map_err(|error| ApiError::Db(error.to_string()))?;
    if let Some(mut redis) = state.redis.clone() {
        let progress = serde_json::json!({
            "status": "cancelled", "last_updated": chrono::Utc::now().timestamp(), "user_id": user_id,
        });
        let _: redis::RedisResult<()> = redis.set_ex(progress_key(&job_id.to_string()), progress.to_string(), 3600).await;
    }
    get_job(State(state), Claims(user), Path(job_id)).await
}

pub async fn retry_job(
    State(state): State<AppState>,
    Claims(user): Claims,
    Path(job_id): Path<Uuid>,
) -> Result<Json<JobRow>, ApiError> {
    let db = require_db(&state)?;
    let bucket = require_bucket(&state)?;
    let user_id = parse_user_id(&user)?;
    let record: Option<(String, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT status, payload FROM jobs WHERE id = $1 AND user_id = $2 FOR UPDATE",
    )
    .bind(job_id).bind(user_id).fetch_optional(&db).await
    .map_err(|error| ApiError::Db(error.to_string()))?;
    let Some((status, Some(payload))) = record else { return Err(ApiError::NotFound); };
    if status != "failed" { return Err(ApiError::Conflict("only failed jobs can be retried".into())); }
    let job: TileJob = serde_json::from_value(payload)
        .map_err(|_| ApiError::Conflict("job cannot be retried because its payload is unavailable".into()))?;
    bucket.head_object(upload_s3_key(&job.job_id)).await
        .map_err(|_| ApiError::Conflict("source upload is no longer available".into()))?;

    let claimed = sqlx::query(
        "UPDATE jobs SET status = 'queued', progress = 0, error = NULL, updated_at = now(),
         completed_at = NULL, cancelled_at = NULL, reservation_released = false
         WHERE id = $1 AND user_id = $2 AND status = 'failed'",
    ).bind(job_id).bind(user_id).execute(&db).await
        .map_err(|error| ApiError::Db(error.to_string()))?;
    if claimed.rows_affected() == 0 {
        return Err(ApiError::Conflict("job retry was already claimed".into()));
    }

    if let Some(reserved) = job.reserved_bytes {
        let allowed: (bool,) = sqlx::query_as("SELECT reserve_storage($1, $2, $3)")
            .bind(user_id).bind(reserved).bind(QUOTA_PRO_BYTES).fetch_one(&db).await
            .map_err(|error| ApiError::Db(error.to_string()))?;
        if !allowed.0 {
            let _ = sqlx::query("UPDATE jobs SET status = 'failed', error = 'storage quota exceeded' WHERE id = $1")
                .bind(job_id).execute(&db).await;
            return Err(ApiError::QuotaExceeded);
        }
    }

    let job_json = serde_json::to_string(&job).map_err(|error| ApiError::Processing(error.to_string()))?;
    let publish_result = if let Some(ref nats) = state.nats {
        nats.publish(NATS_JOBS_SUBJECT, job_json.into()).await
            .map_err(|error| ApiError::Processing(error.to_string()))?.await
            .map(|_| ()).map_err(|error| ApiError::Processing(error.to_string()))
    } else if let Some(mut redis) = state.redis.clone() {
        redis.lpush::<_, _, ()>(REDIS_JOBS_KEY, job_json).await
            .map_err(|error| ApiError::Processing(error.to_string()))
    } else {
        Err(ApiError::ServiceUnavailable("job queue unavailable".into()))
    };
    if let Err(error) = publish_result {
        let _ = sqlx::query("UPDATE jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1")
            .bind(job_id).bind("failed to publish retried job").execute(&db).await;
        let _ = sqlx::query("SELECT release_job_storage_reservation($1)").bind(job_id).execute(&db).await;
        return Err(error);
    }
    if let Some(mut redis) = state.redis.clone() {
        let _: redis::RedisResult<()> = redis.del(progress_key(&job.job_id)).await;
    }
    get_job(State(state), Claims(user), Path(job_id)).await
}

#[derive(Deserialize)]
pub struct ListJobsQuery {
    page: Option<i64>,
    per_page: Option<i64>,
    status: Option<String>,
}

const JOB_COLUMNS: &str = "id, status, file_name, parameters, progress, tiles_done, \
    tiles_total, error, retry_count, created_at, updated_at, completed_at, cancelled_at";

pub async fn reap_stale_jobs(db: &sqlx::PgPool, timeout_seconds: i64) -> Result<u64, sqlx::Error> {
    let stale_ids: Vec<Uuid> = sqlx::query_scalar(
        "UPDATE jobs SET status = 'failed', error = 'worker stopped updating this job', updated_at = now()
         WHERE status = 'processing' AND updated_at < now() - ($1 * interval '1 second')
         RETURNING id",
    )
    .bind(timeout_seconds).fetch_all(db).await?;
    for job_id in &stale_ids {
        sqlx::query("SELECT release_job_storage_reservation($1)")
            .bind(job_id).execute(db).await?;
    }
    Ok(stale_ids.len() as u64)
}

pub async fn list_jobs(
    State(state): State<AppState>,
    Claims(user): Claims,
    Query(query): Query<ListJobsQuery>,
) -> Result<Json<Vec<JobRow>>, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;
    let per_page = query.per_page.unwrap_or(20).clamp(1, 100);
    let offset = (query.page.unwrap_or(1).max(1) - 1) * per_page;
    if query
        .status
        .as_deref()
        .is_some_and(|status| !matches!(status, "queued" | "processing" | "complete" | "failed" | "cancelled"))
    {
        return Err(ApiError::InvalidField("invalid job status".into()));
    }

    let rows = sqlx::query_as::<_, JobRow>(&format!(
        "SELECT {JOB_COLUMNS} FROM jobs
         WHERE user_id = $1 AND ($2::text IS NULL OR status = $2)
         ORDER BY created_at DESC LIMIT $3 OFFSET $4"
    ))
    .bind(user_id)
    .bind(&query.status)
    .bind(per_page)
    .bind(offset)
    .fetch_all(&db)
    .await
    .map_err(|error| ApiError::Db(error.to_string()))?;
    Ok(Json(rows))
}

pub async fn get_job(
    State(state): State<AppState>,
    Claims(user): Claims,
    Path(job_id): Path<Uuid>,
) -> Result<Json<JobRow>, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;
    let row = sqlx::query_as::<_, JobRow>(&format!(
        "SELECT {JOB_COLUMNS} FROM jobs WHERE id = $1 AND user_id = $2"
    ))
    .bind(job_id)
    .bind(user_id)
    .fetch_optional(&db)
    .await
    .map_err(|error| ApiError::Db(error.to_string()))?
    .ok_or(ApiError::NotFound)?;
    Ok(Json(row))
}
