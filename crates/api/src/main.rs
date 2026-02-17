use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, StatusCode},
    response::{
        sse::{Event, KeepAlive},
        IntoResponse, Response, Sse,
    },
    routing::{get, post},
    Json, Router,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tileforge_core::{streaming::should_use_streaming, Projection, TileConfig, Tiler, STREAMING_THRESHOLD};
use tokio_stream::StreamExt;
use axum::http::{HeaderValue, Method};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

struct AppConfig {
    port: u16,
    max_upload_bytes: usize,
    redis_url: Option<String>,
    storage_path: Option<PathBuf>,
    cors_origin: Option<String>,
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
            redis_url: std::env::var("REDIS_URL").ok(),
            storage_path: std::env::var("STORAGE_PATH").ok().map(PathBuf::from),
            cors_origin: std::env::var("CORS_ORIGIN").ok(),
        }
    }
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct AppState {
    max_upload_bytes: usize,
    redis: Option<redis::aio::MultiplexedConnection>,
    storage_path: Option<PathBuf>,
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
    NotFound,
    ServiceUnavailable(String),
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
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not found".into()),
            ApiError::ServiceUnavailable(msg) => (StatusCode::SERVICE_UNAVAILABLE, msg),
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
// Job / progress types (shared with worker)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct JobPayload {
    job_id: String,
    tile_size: u32,
    min_zoom: Option<u32>,
    max_zoom: Option<u32>,
    projection: String,
}

#[derive(Serialize)]
struct AcceptedResponse {
    job_id: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct ProgressData {
    status: String,
    #[serde(default)]
    last_updated: u64,
    zoom: Option<u32>,
    tiles_done: Option<u32>,
    tiles_total: Option<u32>,
    download_url: Option<String>,
    error: Option<String>,
}

// Stale job timeout: 5 minutes with no progress update
const STALE_JOB_TIMEOUT_SECS: u64 = 300;

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

    let projection_str = params.projection.as_deref().unwrap_or("flat");
    let projection = match projection_str {
        "mercator" => Projection::Mercator,
        "flat" => Projection::Flat,
        _ => {
            return Err(ApiError::InvalidField(
                "projection must be 'flat' or 'mercator'".into(),
            ))
        }
    };

    let min_zoom = params.min_zoom;
    let max_zoom = params.max_zoom;

    // Check if the image is large enough to require async processing
    let is_large = should_use_streaming(&body, STREAMING_THRESHOLD);

    if is_large {
        // Async path: enqueue to Redis
        let (mut redis, storage_path) = match (&state.redis, &state.storage_path) {
            (Some(r), Some(s)) => (r.clone(), s.clone()),
            _ => {
                return Err(ApiError::ServiceUnavailable(
                    "async processing not configured (REDIS_URL and STORAGE_PATH required)".into(),
                ));
            }
        };

        let job_id = Uuid::new_v4().to_string();

        // Write image bytes to disk
        let uploads_dir = storage_path.join("uploads");
        tokio::fs::create_dir_all(&uploads_dir)
            .await
            .map_err(|e| ApiError::Processing(format!("failed to create uploads dir: {e}")))?;
        let input_path = uploads_dir.join(format!("{job_id}.bin"));
        tokio::fs::write(&input_path, &body)
            .await
            .map_err(|e| ApiError::Processing(format!("failed to write upload: {e}")))?;

        // Set initial progress in Redis
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let initial_progress = serde_json::json!({
            "status": "queued",
            "last_updated": now,
        });
        let _: redis::RedisResult<()> = redis
            .set_ex(
                format!("tileforge:progress:{job_id}"),
                initial_progress.to_string(),
                3600u64,
            )
            .await;

        // Enqueue job
        let job = JobPayload {
            job_id: job_id.clone(),
            tile_size,
            min_zoom,
            max_zoom,
            projection: projection_str.to_string(),
        };
        let _: redis::RedisResult<()> = redis
            .lpush("tileforge:jobs", serde_json::to_string(&job).unwrap())
            .await;

        tracing::info!(job_id = %job_id, "enqueued async job");

        return Ok((StatusCode::ACCEPTED, Json(AcceptedResponse { job_id })).into_response());
    }

    // Sync path: process inline (unchanged from Phase 1)
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
// SSE progress endpoint
// ---------------------------------------------------------------------------

async fn job_progress(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, axum::Error>>>, ApiError> {
    let redis = state
        .redis
        .as_ref()
        .ok_or_else(|| ApiError::ServiceUnavailable("Redis not configured".into()))?
        .clone();

    let stream = tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(
        std::time::Duration::from_millis(500),
    ))
    .take(1200) // 10 minute safety timeout (1200 * 500ms)
    .then(move |_| {
        let mut conn = redis.clone();
        let key = format!("tileforge:progress:{job_id}");
        async move {
            let val: redis::RedisResult<Option<String>> = conn.get(&key).await;
            match val {
                Ok(Some(json)) => {
                    if let Ok(progress) = serde_json::from_str::<ProgressData>(&json) {
                        // Check for stale jobs (worker crashed)
                        let now = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap()
                            .as_secs();
                        if progress.status == "processing" || progress.status == "queued" {
                            if progress.last_updated > 0
                                && now - progress.last_updated > STALE_JOB_TIMEOUT_SECS
                            {
                                let stale = serde_json::json!({
                                    "status": "failed",
                                    "error": "job timed out (worker may have crashed)",
                                });
                                return Ok(Event::default().data(stale.to_string()));
                            }
                        }
                    }
                    Ok(Event::default().data(json))
                }
                Ok(None) => Ok(Event::default().data(
                    serde_json::json!({"status": "unknown"}).to_string(),
                )),
                Err(e) => Ok(Event::default().data(
                    serde_json::json!({"status": "error", "error": e.to_string()}).to_string(),
                )),
            }
        }
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ---------------------------------------------------------------------------
// Download endpoint
// ---------------------------------------------------------------------------

async fn job_download(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Response, ApiError> {
    let storage_path = state
        .storage_path
        .as_ref()
        .ok_or_else(|| ApiError::ServiceUnavailable("storage not configured".into()))?;

    let zip_path = storage_path
        .join("tiles")
        .join(&job_id)
        .join("tiles.zip");

    let zip_bytes = tokio::fs::read(&zip_path)
        .await
        .map_err(|_| ApiError::NotFound)?;

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

    // Connect to Redis if configured
    let redis = if let Some(ref url) = config.redis_url {
        match redis::Client::open(url.as_str()) {
            Ok(client) => match client.get_multiplexed_async_connection().await {
                Ok(conn) => {
                    tracing::info!("connected to Redis");
                    Some(conn)
                }
                Err(e) => {
                    tracing::warn!("failed to connect to Redis: {e} — async jobs disabled");
                    None
                }
            },
            Err(e) => {
                tracing::warn!("invalid REDIS_URL: {e} — async jobs disabled");
                None
            }
        }
    } else {
        tracing::info!("REDIS_URL not set — async jobs disabled, inline processing only");
        None
    };

    // Ensure storage directories exist
    if let Some(ref path) = config.storage_path {
        tokio::fs::create_dir_all(path.join("uploads")).await.ok();
        tokio::fs::create_dir_all(path.join("tiles")).await.ok();
    }

    let state = AppState {
        max_upload_bytes: config.max_upload_bytes,
        redis,
        storage_path: config.storage_path,
    };

    let cors = match config.cors_origin {
        Some(ref origin) => {
            tracing::info!("CORS origin: {origin}");
            CorsLayer::new()
                .allow_origin(origin.parse::<HeaderValue>().expect("invalid CORS_ORIGIN"))
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers([header::CONTENT_TYPE])
        }
        None => {
            tracing::info!("CORS_ORIGIN not set — allowing all origins");
            CorsLayer::permissive()
        }
    };

    let app = Router::new()
        .route("/health", get(health))
        .route(
            "/api/tiles",
            post(process_tiles).layer(DefaultBodyLimit::max(config.max_upload_bytes)),
        )
        .route("/api/tiles/{job_id}/progress", get(job_progress))
        .route("/api/tiles/{job_id}/download", get(job_download))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
