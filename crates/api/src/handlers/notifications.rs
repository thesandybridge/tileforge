use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{parse_user_id, Claims};
use crate::error::ApiError;
use crate::state::{require_db, AppState};

#[derive(Serialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct NotificationRow {
    id: Uuid,
    user_id: Uuid,
    #[sqlx(rename = "type")]
    #[serde(rename = "type")]
    notification_type: String,
    title: String,
    message: Option<String>,
    link: Option<String>,
    read: bool,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
pub struct CreateNotificationBody {
    #[serde(rename = "type")]
    pub notification_type: String,
    pub title: String,
    pub message: Option<String>,
    pub link: Option<String>,
}

pub fn validate_notification(body: &CreateNotificationBody) -> Result<(), ApiError> {
    if body.notification_type.len() > 50 {
        return Err(ApiError::InvalidField("type must be 50 characters or fewer".into()));
    }
    if body.title.len() > 200 {
        return Err(ApiError::InvalidField("title must be 200 characters or fewer".into()));
    }
    if body.message.as_ref().is_some_and(|m| m.len() > 1000) {
        return Err(ApiError::InvalidField("message must be 1000 characters or fewer".into()));
    }
    Ok(())
}

pub async fn list_notifications(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<Json<Vec<NotificationRow>>, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    let rows = sqlx::query_as::<_, NotificationRow>(
        "SELECT id, user_id, type, title, message, link, read, created_at
         FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
    )
    .bind(user_id)
    .fetch_all(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    Ok(Json(rows))
}

pub async fn create_notification(
    State(state): State<AppState>,
    Claims(user): Claims,
    Json(body): Json<CreateNotificationBody>,
) -> Result<Response, ApiError> {
    validate_notification(&body)?;

    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    let row = sqlx::query_as::<_, NotificationRow>(
        "INSERT INTO notifications (user_id, type, title, message, link)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, type, title, message, link, read, created_at",
    )
    .bind(user_id)
    .bind(&body.notification_type)
    .bind(&body.title)
    .bind(&body.message)
    .bind(&body.link)
    .fetch_one(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    Ok((StatusCode::CREATED, Json(row)).into_response())
}

pub async fn mark_notifications_read(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    sqlx::query("UPDATE notifications SET read = true WHERE user_id = $1 AND read = false")
        .bind(user_id)
        .execute(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn clear_notifications(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    sqlx::query("DELETE FROM notifications WHERE user_id = $1")
        .bind(user_id)
        .execute(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(notification_type: &str, title: &str, message: Option<&str>) -> CreateNotificationBody {
        CreateNotificationBody {
            notification_type: notification_type.into(),
            title: title.into(),
            message: message.map(|s| s.into()),
            link: None,
        }
    }

    #[test]
    fn valid_notification() {
        assert!(validate_notification(&body("info", "Hello", None)).is_ok());
    }

    #[test]
    fn type_too_long() {
        let long_type = "a".repeat(51);
        assert!(validate_notification(&body(&long_type, "Hello", None)).is_err());
    }

    #[test]
    fn type_at_limit() {
        let type_50 = "a".repeat(50);
        assert!(validate_notification(&body(&type_50, "Hello", None)).is_ok());
    }

    #[test]
    fn title_too_long() {
        let long_title = "a".repeat(201);
        assert!(validate_notification(&body("info", &long_title, None)).is_err());
    }

    #[test]
    fn title_at_limit() {
        let title_200 = "a".repeat(200);
        assert!(validate_notification(&body("info", &title_200, None)).is_ok());
    }

    #[test]
    fn message_too_long() {
        let long_msg = "a".repeat(1001);
        assert!(validate_notification(&body("info", "Hi", Some(&long_msg))).is_err());
    }

    #[test]
    fn message_at_limit() {
        let msg_1000 = "a".repeat(1000);
        assert!(validate_notification(&body("info", "Hi", Some(&msg_1000))).is_ok());
    }

    #[test]
    fn message_none_is_ok() {
        assert!(validate_notification(&body("info", "Hi", None)).is_ok());
    }
}
