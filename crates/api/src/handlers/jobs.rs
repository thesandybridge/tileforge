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

    if let Some(reserved) = job.reserved_bytes {
        let allowed: (bool,) = sqlx::query_as("SELECT reserve_storage($1, $2, $3)")
            .bind(user_id).bind(reserved).bind(QUOTA_PRO_BYTES).fetch_one(&db).await
            .map_err(|error| ApiError::Db(error.to_string()))?;
        if !allowed.0 { return Err(ApiError::QuotaExceeded); }
    }

    let job_json = serde_json::to_string(&job).map_err(|error| ApiError::Processing(error.to_string()))?;
    if let Some(ref nats) = state.nats {
        nats.publish(NATS_JOBS_SUBJECT, job_json.into()).await
            .map_err(|error| ApiError::Processing(error.to_string()))?.await
            .map_err(|error| ApiError::Processing(error.to_string()))?;
    } else if let Some(mut redis) = state.redis.clone() {
        let _: () = redis.lpush(REDIS_JOBS_KEY, job_json).await
            .map_err(|error| ApiError::Processing(error.to_string()))?;
        let _: () = redis.del(progress_key(&job.job_id)).await
            .map_err(|error| ApiError::Processing(error.to_string()))?;
    } else {
        return Err(ApiError::ServiceUnavailable("job queue unavailable".into()));
    }

    sqlx::query("UPDATE jobs SET status = 'queued', progress = 0, error = NULL, updated_at = now(), completed_at = NULL WHERE id = $1")
        .bind(job_id).execute(&db).await.map_err(|error| ApiError::Db(error.to_string()))?;
    get_job(State(state), Claims(user), Path(job_id)).await
}

#[derive(Deserialize)]
pub struct ListJobsQuery {
    page: Option<i64>,
    per_page: Option<i64>,
    status: Option<String>,
}

const JOB_COLUMNS: &str = "id, status, file_name, parameters, progress, tiles_done, \
    tiles_total, error, retry_count, created_at, updated_at, completed_at";

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
        .is_some_and(|status| !matches!(status, "queued" | "processing" | "complete" | "failed"))
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
