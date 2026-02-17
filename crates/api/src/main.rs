use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use tileforge_core::{Projection, TileConfig, Tiler};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

struct AppConfig {
    port: u16,
    max_upload_bytes: usize,
}

impl AppConfig {
    fn from_env() -> Self {
        Self {
            port: std::env::var("PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8080),
            max_upload_bytes: std::env::var("MAX_UPLOAD_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(500 * 1024 * 1024), // 500 MB
        }
    }
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct AppState {
    max_upload_bytes: usize,
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug)]
enum ApiError {
    MissingImage,
    ImageTooLarge { limit: usize },
    InvalidField(String),
    Processing(String),
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::MissingImage => (
                StatusCode::BAD_REQUEST,
                "request body must contain image bytes".into(),
            ),
            ApiError::ImageTooLarge { limit } => (
                StatusCode::PAYLOAD_TOO_LARGE,
                format!("image exceeds maximum size of {} MB", limit / (1024 * 1024)),
            ),
            ApiError::InvalidField(msg) => (StatusCode::BAD_REQUEST, msg),
            ApiError::Processing(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
        };
        (status, Json(ErrorBody { error: message })).into_response()
    }
}

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct TileParams {
    tile_size: Option<u32>,
    min_zoom: Option<u32>,
    max_zoom: Option<u32>,
    projection: Option<String>,
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async fn health() -> &'static str {
    "ok"
}

async fn process_tiles(
    State(state): State<AppState>,
    Query(params): Query<TileParams>,
    body: Bytes,
) -> Result<Response, ApiError> {
    if body.is_empty() {
        return Err(ApiError::MissingImage);
    }
    if body.len() > state.max_upload_bytes {
        return Err(ApiError::ImageTooLarge {
            limit: state.max_upload_bytes,
        });
    }

    let tile_size = params.tile_size.unwrap_or(256);
    if !matches!(tile_size, 128 | 256 | 512) {
        return Err(ApiError::InvalidField(
            "tile_size must be 128, 256, or 512".into(),
        ));
    }

    let projection = match params.projection.as_deref() {
        Some("mercator") => Projection::Mercator,
        Some("flat") | None => Projection::Flat,
        _ => {
            return Err(ApiError::InvalidField(
                "projection must be 'flat' or 'mercator'".into(),
            ))
        }
    };

    let min_zoom = params.min_zoom;
    let max_zoom = params.max_zoom;
    let image_bytes = body.to_vec();

    let zip_bytes = tokio::task::spawn_blocking(move || {
        let config = TileConfig {
            tile_size,
            min_zoom,
            max_zoom,
            projection,
        };
        let tiler = Tiler::new(config);
        let mut buf = Cursor::new(Vec::new());
        tiler
            .process_bytes(&image_bytes, &mut buf, |_| {})
            .map_err(|e| ApiError::Processing(e.to_string()))?;
        Ok::<_, ApiError>(buf.into_inner())
    })
    .await
    .map_err(|e| ApiError::Processing(format!("task join error: {e}")))?;

    let zip_bytes = zip_bytes?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"tiles.zip\"",
            ),
        ],
        zip_bytes,
    )
        .into_response())
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tileforge_api=info,tower_http=info".into()),
        )
        .init();

    let config = AppConfig::from_env();
    let state = AppState {
        max_upload_bytes: config.max_upload_bytes,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route(
            "/api/tiles",
            post(process_tiles).layer(DefaultBodyLimit::max(config.max_upload_bytes)),
        )
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
