use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;

use crate::auth::{parse_user_id, Claims, Plan};
use crate::error::ApiError;
use crate::state::{require_db, AppState, QUOTA_PRO_BYTES};

#[derive(Serialize, utoipa::ToSchema)]
pub struct UserResponse {
    id: String,
    plan: Plan,
    storage_used: i64,
    storage_quota: i64,
}

#[utoipa::path(
    get,
    path = "/api/user",
    tag = "User",
    responses(
        (status = 200, description = "Current user info", body = UserResponse),
        (status = 401, description = "Unauthorized", body = crate::error::ErrorBody)
    )
)]
pub async fn get_current_user(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<Json<UserResponse>, ApiError> {
    let (storage_used, storage_quota) = if user.plan == Plan::Pro {
        if let Some(ref db) = state.db {
            let uid = parse_user_id(&user)?;
            let row: (i64,) = sqlx::query_as("SELECT storage_used_bytes FROM users WHERE id = $1")
                .bind(uid)
                .fetch_one(db)
                .await
                .map_err(|e| ApiError::Db(e.to_string()))?;
            (row.0, QUOTA_PRO_BYTES)
        } else {
            (0, QUOTA_PRO_BYTES)
        }
    } else {
        (0, 0)
    };

    Ok(Json(UserResponse {
        id: user.sub,
        plan: user.plan,
        storage_used,
        storage_quota,
    }))
}

pub async fn deactivate_user(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    let mut tx = db.begin().await.map_err(|e| ApiError::Db(e.to_string()))?;

    sqlx::query("UPDATE api_keys SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    sqlx::query("UPDATE users SET deactivated_at = now() WHERE id = $1 AND deactivated_at IS NULL")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    tx.commit().await.map_err(|e| ApiError::Db(e.to_string()))?;

    tracing::info!(user_id = %user_id, "user deactivated");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn reactivate_user(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    let result = sqlx::query_scalar::<_, Option<chrono::DateTime<chrono::Utc>>>(
        "SELECT deactivated_at FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    match result {
        Some(Some(deactivated_at)) => {
            let days_since = (chrono::Utc::now() - deactivated_at).num_days();
            if days_since > 30 {
                return Err(ApiError::InvalidField(
                    "reactivation window has expired (30 days)".into(),
                ));
            }
            sqlx::query("UPDATE users SET deactivated_at = NULL WHERE id = $1")
                .bind(user_id)
                .execute(&db)
                .await
                .map_err(|e| ApiError::Db(e.to_string()))?;
            tracing::info!(user_id = %user_id, "user reactivated");
            Ok(StatusCode::NO_CONTENT)
        }
        _ => Err(ApiError::InvalidField("account is not deactivated".into())),
    }
}
