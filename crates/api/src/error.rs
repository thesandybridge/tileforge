use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::Serialize;

#[derive(Debug)]
pub enum ApiError {
    MissingImage,
    ImageTooLarge { limit: usize },
    InvalidField(String),
    Processing(String),
    NotFound,
    Unauthorized,
    Forbidden,
    ServiceUnavailable(String),
    Db(String),
    Conflict(String),
    QuotaExceeded,
    FormatRequiresPro(String),
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct ErrorBody {
    pub error: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match self {
            Self::MissingImage => (
                StatusCode::BAD_REQUEST,
                "request body must contain image bytes".into(),
            ),
            Self::ImageTooLarge { limit } => (
                StatusCode::PAYLOAD_TOO_LARGE,
                format!("image exceeds maximum size of {} MB", limit / (1024 * 1024)),
            ),
            Self::InvalidField(msg) => (StatusCode::BAD_REQUEST, msg),
            Self::Processing(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
            Self::NotFound => (StatusCode::NOT_FOUND, "not found".into()),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "authentication required".into()),
            Self::Forbidden => (StatusCode::FORBIDDEN, "forbidden".into()),
            Self::ServiceUnavailable(msg) => (StatusCode::SERVICE_UNAVAILABLE, msg),
            Self::Db(msg) => {
                tracing::error!("database error: {msg}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal server error".into())
            }
            Self::Conflict(msg) => (StatusCode::CONFLICT, msg),
            Self::QuotaExceeded => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "storage quota exceeded (5 GB limit)".into(),
            ),
            Self::FormatRequiresPro(fmt) => (
                StatusCode::FORBIDDEN,
                format!("{fmt} format requires a Pro plan"),
            ),
        };
        (status, Json(ErrorBody { error: message })).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    fn status_of(err: ApiError) -> StatusCode {
        err.into_response().status()
    }

    #[test]
    fn missing_image_is_400() {
        assert_eq!(status_of(ApiError::MissingImage), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn image_too_large_is_413() {
        assert_eq!(
            status_of(ApiError::ImageTooLarge { limit: 10 * 1024 * 1024 }),
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }

    #[test]
    fn invalid_field_is_400() {
        assert_eq!(
            status_of(ApiError::InvalidField("bad".into())),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn processing_is_500() {
        assert_eq!(
            status_of(ApiError::Processing("oops".into())),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn not_found_is_404() {
        assert_eq!(status_of(ApiError::NotFound), StatusCode::NOT_FOUND);
    }

    #[test]
    fn unauthorized_is_401() {
        assert_eq!(status_of(ApiError::Unauthorized), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn forbidden_is_403() {
        assert_eq!(status_of(ApiError::Forbidden), StatusCode::FORBIDDEN);
    }

    #[test]
    fn service_unavailable_is_503() {
        assert_eq!(
            status_of(ApiError::ServiceUnavailable("down".into())),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[test]
    fn db_error_is_500_and_hides_details() {
        let resp = ApiError::Db("secret sql error".into()).into_response();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn conflict_is_409() {
        assert_eq!(
            status_of(ApiError::Conflict("duplicate".into())),
            StatusCode::CONFLICT
        );
    }

    #[test]
    fn quota_exceeded_is_413() {
        assert_eq!(status_of(ApiError::QuotaExceeded), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[test]
    fn format_requires_pro_is_403() {
        assert_eq!(
            status_of(ApiError::FormatRequiresPro("TIFF".into())),
            StatusCode::FORBIDDEN
        );
    }
}
