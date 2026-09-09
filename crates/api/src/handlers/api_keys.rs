use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use rand::{rngs::OsRng, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::auth::{parse_user_id, Claims, Plan};
use crate::error::ApiError;
use crate::state::{require_db, AppState};

#[derive(Serialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct ApiKeyRow {
    id: Uuid,
    name: String,
    key_prefix: String,
    scopes: Vec<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    last_used_at: Option<chrono::DateTime<chrono::Utc>>,
    device_info: Option<serde_json::Value>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct ApiKeyCreatedResponse {
    id: Uuid,
    key: String,
    key_prefix: String,
    name: String,
    scopes: Vec<String>,
    created_at: chrono::DateTime<chrono::Utc>,
}

const KEY_COLUMNS: &str = "id, name, key_prefix, scopes, created_at, last_used_at, device_info";

#[derive(Deserialize)]
pub struct UpdateApiKey { name: String }

#[derive(Deserialize)]
pub struct CreateCliKey {
    device_name: String,
    os: String,
    arch: String,
}

fn valid_name(name: &str) -> bool {
    let length = name.trim().chars().count();
    (1..=64).contains(&length) && !name.chars().any(char::is_control)
}

pub async fn create_api_key(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<Response, ApiError> {
    user.require_scope("manage")?;
    if user.plan != Plan::Pro {
        return Err(ApiError::Forbidden);
    }
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    let random_bytes: [u8; 16] = OsRng.gen();
    let raw_key = format!("tf_{}", hex::encode(random_bytes));
    let key_hash = hex::encode(Sha256::digest(raw_key.as_bytes()));
    let key_prefix = raw_key[..11].to_string();

    let row = sqlx::query_as::<_, ApiKeyRow>(
        "INSERT INTO api_keys (user_id, key_hash, key_prefix, name, scopes)
         VALUES ($1, $2, $3, 'Service key', ARRAY['read', 'process', 'manage'])
         RETURNING id, name, key_prefix, scopes, created_at, last_used_at, device_info",
    )
    .bind(user_id)
    .bind(&key_hash)
    .bind(&key_prefix)
    .fetch_one(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    Ok((
        StatusCode::CREATED,
        Json(ApiKeyCreatedResponse {
            id: row.id,
            key: raw_key,
            key_prefix: row.key_prefix,
            name: row.name,
            scopes: row.scopes,
            created_at: row.created_at,
        }),
    )
        .into_response())
}

/// Creates an additional key for a CLI login without rotating service keys.
pub async fn create_cli_api_key(
    State(state): State<AppState>,
    Claims(user): Claims,
    Json(body): Json<CreateCliKey>,
) -> Result<Response, ApiError> {
    user.require_scope("manage")?;
    if user.plan != Plan::Pro { return Err(ApiError::Forbidden); }
    if !valid_name(&body.device_name) || !valid_name(&body.os) || !valid_name(&body.arch) {
        return Err(ApiError::InvalidField("invalid CLI device information".into()));
    }
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;
    let random_bytes: [u8; 16] = OsRng.gen();
    let raw_key = format!("tf_{}", hex::encode(random_bytes));
    let key_hash = hex::encode(Sha256::digest(raw_key.as_bytes()));
    let key_prefix = raw_key[..11].to_string();
    let row = sqlx::query_as::<_, ApiKeyRow>(
        "INSERT INTO api_keys (user_id, key_hash, key_prefix, name, scopes, device_info)
         VALUES ($1, $2, $3, $4, ARRAY['read', 'process'], $5)
         RETURNING id, name, key_prefix, scopes, created_at, last_used_at, device_info",
    )
    .bind(user_id).bind(key_hash).bind(&key_prefix)
    .bind(format!("CLI — {}", body.device_name))
    .bind(serde_json::json!({ "device_name": body.device_name, "os": body.os, "arch": body.arch }))
    .fetch_one(&db).await
    .map_err(|error| ApiError::Db(error.to_string()))?;
    Ok((StatusCode::CREATED, Json(ApiKeyCreatedResponse {
        id: row.id, key: raw_key, key_prefix: row.key_prefix, name: row.name,
        scopes: row.scopes, created_at: row.created_at,
    })).into_response())
}

pub async fn get_api_key(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<Response, ApiError> {
    user.require_scope("manage")?;
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    let rows = sqlx::query_as::<_, ApiKeyRow>(&format!(
        "SELECT {KEY_COLUMNS} FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC"
    ))
    .bind(user_id)
    .fetch_all(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    Ok(Json(rows).into_response())
}

pub async fn update_api_key(
    State(state): State<AppState>, Claims(user): Claims, Path(key_id): Path<Uuid>, Json(body): Json<UpdateApiKey>,
) -> Result<Json<ApiKeyRow>, ApiError> {
    user.require_scope("manage")?;
    if !valid_name(&body.name) { return Err(ApiError::InvalidField("name must be 1-64 printable characters".into())); }
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;
    let row = sqlx::query_as::<_, ApiKeyRow>(&format!(
        "UPDATE api_keys SET name = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING {KEY_COLUMNS}"
    )).bind(key_id).bind(user_id).bind(body.name.trim()).fetch_optional(&db).await
        .map_err(|error| ApiError::Db(error.to_string()))?.ok_or(ApiError::NotFound)?;
    Ok(Json(row))
}

pub async fn revoke_api_key_by_id(
    State(state): State<AppState>, Claims(user): Claims, Path(key_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    user.require_scope("manage")?;
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;
    let result = sqlx::query("UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL")
        .bind(key_id).bind(user_id).execute(&db).await.map_err(|error| ApiError::Db(error.to_string()))?;
    if result.rows_affected() == 0 { return Err(ApiError::NotFound); }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn revoke_current_api_key(
    State(state): State<AppState>, Claims(user): Claims,
) -> Result<StatusCode, ApiError> {
    let key_id = user.api_key_id.ok_or(ApiError::Forbidden)?;
    let db = require_db(&state)?;
    sqlx::query("UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL")
        .bind(key_id).execute(&db).await.map_err(|error| ApiError::Db(error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn revoke_api_key(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    user.require_scope("manage")?;
    let user_id = parse_user_id(&user)?;

    sqlx::query("UPDATE api_keys SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}
