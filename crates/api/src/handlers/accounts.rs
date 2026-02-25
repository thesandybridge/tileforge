use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;

use crate::auth::{parse_user_id, Claims};
use crate::error::ApiError;
use crate::state::{require_db, AppState};

#[derive(Serialize)]
pub struct LinkedAccount {
    pub provider: String,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
    pub email: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_accounts(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<Json<Vec<LinkedAccount>>, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    let rows: Vec<(
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        chrono::DateTime<chrono::Utc>,
    )> = sqlx::query_as(
        "SELECT provider, username, avatar_url, email, created_at
         FROM accounts WHERE user_id = $1 ORDER BY created_at",
    )
    .bind(user_id)
    .fetch_all(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    let accounts = rows
        .into_iter()
        .map(|(provider, username, avatar_url, email, created_at)| LinkedAccount {
            provider,
            username,
            avatar_url,
            email,
            created_at,
        })
        .collect();

    Ok(Json(accounts))
}

pub async fn unlink_account(
    State(state): State<AppState>,
    Claims(user): Claims,
    Path(provider): Path<String>,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    // Count linked accounts — must keep at least 1
    let count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM accounts WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&db)
            .await
            .map_err(|e| ApiError::Db(e.to_string()))?;

    if count.0 <= 1 {
        return Err(ApiError::InvalidField(
            "cannot unlink last provider — at least one must remain".into(),
        ));
    }

    let result = sqlx::query("DELETE FROM accounts WHERE user_id = $1 AND provider = $2")
        .bind(user_id)
        .bind(&provider)
        .execute(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    tracing::info!(user_id = %user_id, provider = %provider, "provider unlinked");
    Ok(StatusCode::NO_CONTENT)
}
