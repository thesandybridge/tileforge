use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use rand::Rng;
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::auth::{parse_user_id, Claims, Plan};
use crate::error::ApiError;
use crate::state::{require_db, AppState};

#[derive(Serialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct ApiKeyRow {
    id: Uuid,
    key_prefix: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct ApiKeyCreatedResponse {
    id: Uuid,
    key: String,
    key_prefix: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn create_api_key(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<Response, ApiError> {
    if user.plan != Plan::Pro {
        return Err(ApiError::Forbidden);
    }
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    let random_bytes: [u8; 16] = rand::thread_rng().gen();
    let raw_key = format!("tf_{}", hex::encode(random_bytes));
    let key_hash = hex::encode(Sha256::digest(raw_key.as_bytes()));
    let key_prefix = raw_key[..11].to_string();

    let mut tx = db.begin().await.map_err(|e| ApiError::Db(e.to_string()))?;

    // Revoke any existing active key
    sqlx::query("UPDATE api_keys SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    let row = sqlx::query_as::<_, ApiKeyRow>(
        "INSERT INTO api_keys (user_id, key_hash, key_prefix)
         VALUES ($1, $2, $3)
         RETURNING id, key_prefix, created_at",
    )
    .bind(user_id)
    .bind(&key_hash)
    .bind(&key_prefix)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    tx.commit().await.map_err(|e| ApiError::Db(e.to_string()))?;

    Ok((
        StatusCode::CREATED,
        Json(ApiKeyCreatedResponse {
            id: row.id,
            key: raw_key,
            key_prefix: row.key_prefix,
            created_at: row.created_at,
        }),
    )
        .into_response())
}

pub async fn get_api_key(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<Response, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    let row = sqlx::query_as::<_, ApiKeyRow>(
        "SELECT id, key_prefix, created_at FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .fetch_optional(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    match row {
        Some(key) => Ok(Json(key).into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

pub async fn revoke_api_key(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    sqlx::query("UPDATE api_keys SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}
