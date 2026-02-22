use axum::{
    extract::State,
    http::Request,
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use crate::auth::verify_admin;
use crate::error::ApiError;
use crate::handlers::notifications::CreateNotificationBody;
use crate::state::{delete_tileset_s3_objects, require_db, AppState};

#[derive(Serialize)]
pub struct BroadcastResponse {
    notified: i64,
}

#[derive(Serialize)]
pub struct PurgeResponse {
    deleted: u64,
}

pub async fn broadcast_notification(
    State(state): State<AppState>,
    req: Request<axum::body::Body>,
) -> Result<Json<BroadcastResponse>, ApiError> {
    verify_admin(&state, &req)?;

    let body_bytes = axum::body::to_bytes(req.into_body(), 1024 * 64)
        .await
        .map_err(|_| ApiError::InvalidField("invalid request body".into()))?;
    let body: CreateNotificationBody = serde_json::from_slice(&body_bytes)
        .map_err(|e| ApiError::InvalidField(format!("invalid JSON: {e}")))?;

    crate::handlers::notifications::validate_notification(&body)?;

    let db = require_db(&state)?;

    let user_ids: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM users WHERE deactivated_at IS NULL",
    )
    .fetch_all(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    let ids: Vec<Uuid> = user_ids.into_iter().map(|(id,)| id).collect();
    let count = ids.len() as i64;

    if count > 0 {
        sqlx::query(
            "INSERT INTO notifications (user_id, type, title, message, link)
             SELECT unnest($1::uuid[]), $2, $3, $4, $5",
        )
        .bind(&ids)
        .bind(&body.notification_type)
        .bind(&body.title)
        .bind(&body.message)
        .bind(&body.link)
        .execute(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;
    }

    tracing::info!(count = count, "broadcast notification to all users");
    Ok(Json(BroadcastResponse { notified: count }))
}

pub async fn purge_deactivated(
    State(state): State<AppState>,
    req: Request<axum::body::Body>,
) -> Result<Json<PurgeResponse>, ApiError> {
    verify_admin(&state, &req)?;

    let db = require_db(&state)?;

    let rows: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM users WHERE deactivated_at < now() - INTERVAL '30 days'",
    )
    .fetch_all(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    if rows.is_empty() {
        return Ok(Json(PurgeResponse { deleted: 0 }));
    }

    let user_ids: Vec<Uuid> = rows.into_iter().map(|(id,)| id).collect();
    let deleted = user_ids.len() as u64;

    // Clean up S3 objects
    let tilesets: Vec<(String,)> = sqlx::query_as(
        "SELECT storage_path FROM tile_sets WHERE user_id = ANY($1::uuid[])",
    )
    .bind(&user_ids)
    .fetch_all(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    if let Some(ref bucket) = state.bucket {
        for (storage_path,) in &tilesets {
            delete_tileset_s3_objects(bucket, storage_path).await;
        }
    }

    // CASCADE handles tile_sets and api_keys
    sqlx::query("DELETE FROM users WHERE id = ANY($1::uuid[])")
        .bind(&user_ids)
        .execute(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    for uid in &user_ids {
        tracing::info!(user_id = %uid, "purged deactivated user");
    }

    Ok(Json(PurgeResponse { deleted }))
}
