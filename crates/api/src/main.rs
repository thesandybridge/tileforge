mod s3;

use axum::{
    body::Bytes,
    extract::{ConnectInfo, DefaultBodyLimit, FromRequestParts, Path, Query, State},
    http::{header, HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive},
        IntoResponse, Response, Sse,
    },
    routing::{get, post},
    Json, Router,
};
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::io::Cursor;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tileforge_core::{streaming::should_use_streaming, Projection, TileConfig, Tiler, ZipTileWriter, STREAMING_THRESHOLD};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

struct AppConfig {
    port: u16,
    max_upload_bytes: usize,
    redis_url: Option<String>,
    cors_origin: Option<String>,
    database_url: Option<String>,
    jwt_secret: Option<String>,
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
            cors_origin: std::env::var("CORS_ORIGIN").ok(),
            database_url: std::env::var("DATABASE_URL").ok(),
            jwt_secret: std::env::var("JWT_SECRET").ok(),
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
    bucket: Option<Arc<s3::Bucket>>,
    db: Option<PgPool>,
    jwt_secret: Option<String>,
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
    Unauthorized,
    #[allow(dead_code)]
    Forbidden,
    ServiceUnavailable(String),
    Db(String),
    Conflict(String),
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
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "authentication required".into()),
            ApiError::Forbidden => (StatusCode::FORBIDDEN, "forbidden".into()),
            ApiError::ServiceUnavailable(msg) => (StatusCode::SERVICE_UNAVAILABLE, msg),
            ApiError::Db(msg) => (StatusCode::INTERNAL_SERVER_ERROR, format!("database error: {msg}")),
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, msg),
        };
        (status, Json(ErrorBody { error: message })).into_response()
    }
}

// ---------------------------------------------------------------------------
// JWT auth
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize)]
struct UserClaims {
    sub: String,
    plan: String,
    iat: Option<u64>,
    exp: Option<u64>,
}

/// Middleware: extract Bearer token, validate JWT, inject UserClaims into extensions.
/// No-op if no token or JWT_SECRET is not configured.
async fn optional_auth(
    State(state): State<AppState>,
    mut req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    if let Some(ref secret) = state.jwt_secret {
        if let Some(auth_header) = req.headers().get(header::AUTHORIZATION) {
            if let Ok(val) = auth_header.to_str() {
                if let Some(token) = val.strip_prefix("Bearer ") {
                    let key = DecodingKey::from_secret(secret.as_bytes());
                    let mut validation = Validation::new(Algorithm::HS256);
                    validation.set_required_spec_claims(&["sub", "exp"]);
                    if let Ok(data) = decode::<UserClaims>(token, &key, &validation) {
                        req.extensions_mut().insert(data.claims);
                    }
                }
            }
        }
    }
    next.run(req).await
}

/// Extractor: requires authenticated user (401 if absent).
struct Claims(UserClaims);

impl<S: Send + Sync> FromRequestParts<S> for Claims {
    type Rejection = ApiError;

    fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        async move {
            parts
                .extensions
                .get::<UserClaims>()
                .cloned()
                .map(Claims)
                .ok_or(ApiError::Unauthorized)
        }
    }
}

/// Extractor: optionally authenticated user (None if absent).
struct OptionalClaims(Option<UserClaims>);

impl<S: Send + Sync> FromRequestParts<S> for OptionalClaims {
    type Rejection = ApiError;

    fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        async move {
            Ok(OptionalClaims(parts.extensions.get::<UserClaims>().cloned()))
        }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    user_id: Option<String>,
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
    pmtiles_url: Option<String>,
    error: Option<String>,
}

// Stale job timeout: 5 minutes with no progress update
const STALE_JOB_TIMEOUT_SECS: u64 = 300;

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct RateLimit {
    redis: Option<redis::aio::MultiplexedConnection>,
}

#[derive(Serialize)]
struct RateLimitBody {
    error: String,
    retry_after: u64,
}

fn extract_client_ip<B>(req: &Request<B>, peer: Option<SocketAddr>) -> String {
    // Prefer CF-Connecting-IP (Cloudflare), then X-Forwarded-For (leftmost), then peer
    if let Some(cf_ip) = req.headers().get("cf-connecting-ip") {
        if let Ok(ip) = cf_ip.to_str() {
            return ip.trim().to_string();
        }
    }
    if let Some(xff) = req.headers().get("x-forwarded-for") {
        if let Ok(val) = xff.to_str() {
            if let Some(first) = val.split(',').next() {
                return first.trim().to_string();
            }
        }
    }
    peer.map(|a| a.ip().to_string()).unwrap_or_else(|| "unknown".into())
}

impl RateLimit {
    /// Check rate limit. Returns Ok(()) if allowed, or an error response if exceeded.
    async fn check(&self, ip: &str, endpoint: &str, max_requests: u64, window_secs: u64) -> Result<(), Response> {
        let mut conn = match self.redis {
            Some(ref c) => c.clone(),
            None => return Ok(()), // No Redis = no rate limiting
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let window = now / window_secs;
        let key = format!("ratelimit:{ip}:{endpoint}:{window}");

        let count: u64 = match conn.incr(&key, 1u64).await {
            Ok(c) => c,
            Err(_) => return Ok(()), // Redis error = fail open
        };

        // Set expiry on first increment
        if count == 1 {
            let _: redis::RedisResult<()> = conn.expire(&key, window_secs as i64).await;
        }

        if count > max_requests {
            let retry_after = window_secs - (now % window_secs);
            let body = RateLimitBody {
                error: "Rate limit exceeded".into(),
                retry_after,
            };
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                [(header::RETRY_AFTER, retry_after.to_string().parse::<HeaderValue>().unwrap())],
                Json(body),
            )
                .into_response());
        }

        Ok(())
    }
}

async fn rate_limit_tiles(
    State(rl): State<RateLimit>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let ip = extract_client_ip(&req, Some(addr));
    if let Err(resp) = rl.check(&ip, "post_tiles", 10, 60).await {
        return resp;
    }
    next.run(req).await
}

async fn rate_limit_progress(
    State(rl): State<RateLimit>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let ip = extract_client_ip(&req, Some(addr));
    if let Err(resp) = rl.check(&ip, "progress", 60, 60).await {
        return resp;
    }
    next.run(req).await
}

async fn rate_limit_download(
    State(rl): State<RateLimit>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let ip = extract_client_ip(&req, Some(addr));
    if let Err(resp) = rl.check(&ip, "download", 30, 60).await {
        return resp;
    }
    next.run(req).await
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async fn health() -> &'static str {
    "ok"
}

async fn process_tiles(
    State(state): State<AppState>,
    claims: OptionalClaims,
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
        // Async path: enqueue to Redis, upload to S3
        let (mut redis, bucket) = match (&state.redis, &state.bucket) {
            (Some(r), Some(b)) => (r.clone(), b.clone()),
            _ => {
                return Err(ApiError::ServiceUnavailable(
                    "async processing not configured (REDIS_URL and S3 env vars required)".into(),
                ));
            }
        };

        let job_id = Uuid::new_v4().to_string();

        // Upload image bytes to S3
        let s3_key = format!("uploads/{job_id}.bin");
        bucket
            .put_object(&s3_key, &body)
            .await
            .map_err(|e| ApiError::Processing(format!("S3 upload failed: {e}")))?;

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
            user_id: claims.0.as_ref().map(|c| c.sub.clone()),
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
        let buf = Cursor::new(Vec::new());
        let mut zip_writer = ZipTileWriter::new(buf);
        tiler
            .process_bytes(&image_bytes, &mut zip_writer, |_| {})
            .map_err(|e| ApiError::Processing(e.to_string()))?;
        Ok::<_, ApiError>(zip_writer.into_inner().unwrap().into_inner())
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

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, axum::Error>>(2);

    tokio::spawn(async move {
        let mut conn = redis;
        let key = format!("tileforge:progress:{job_id}");
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(500));

        for _ in 0..1200u32 {
            interval.tick().await;

            let val: redis::RedisResult<Option<String>> = conn.get(&key).await;

            let (event, is_terminal) = match val {
                Ok(Some(json)) => {
                    let mut terminal = false;
                    if let Ok(progress) = serde_json::from_str::<ProgressData>(&json) {
                        if progress.status == "complete" || progress.status == "failed" {
                            terminal = true;
                        } else if progress.status == "processing"
                            || progress.status == "queued"
                        {
                            // Check for stale jobs (worker crashed)
                            let now = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap()
                                .as_secs();
                            if progress.last_updated > 0
                                && now - progress.last_updated > STALE_JOB_TIMEOUT_SECS
                            {
                                let stale = serde_json::json!({
                                    "status": "failed",
                                    "error": "job timed out (worker may have crashed)",
                                });
                                let event = Ok(Event::default().data(stale.to_string()));
                                if tx.send(event).await.is_err() {
                                    return;
                                }
                                break;
                            }
                        }
                    }
                    (Ok(Event::default().data(json)), terminal)
                }
                Ok(None) => (
                    Ok(Event::default()
                        .data(serde_json::json!({"status": "unknown"}).to_string())),
                    false,
                ),
                Err(e) => (
                    Ok(Event::default().data(
                        serde_json::json!({"status": "error", "error": e.to_string()})
                            .to_string(),
                    )),
                    true,
                ),
            };

            if tx.send(event).await.is_err() {
                break; // client disconnected
            }
            if is_terminal {
                break;
            }
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ---------------------------------------------------------------------------
// Download endpoint
// ---------------------------------------------------------------------------

async fn job_download(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Response, ApiError> {
    let bucket = state
        .bucket
        .as_ref()
        .ok_or_else(|| ApiError::ServiceUnavailable("S3 not configured".into()))?;

    let s3_key = format!("tiles/{job_id}/tiles.zip");
    let resp = bucket
        .get_object(&s3_key)
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
        resp.to_vec(),
    )
        .into_response())
}

async fn job_download_pmtiles(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Response, ApiError> {
    let bucket = state
        .bucket
        .as_ref()
        .ok_or_else(|| ApiError::ServiceUnavailable("S3 not configured".into()))?;

    let s3_key = format!("tiles/{job_id}/tiles.pmtiles");
    let resp = bucket
        .get_object(&s3_key)
        .await
        .map_err(|_| ApiError::NotFound)?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"tiles.pmtiles\"",
            ),
        ],
        resp.to_vec(),
    )
        .into_response())
}

// ---------------------------------------------------------------------------
// Tile set CRUD
// ---------------------------------------------------------------------------

fn require_db(state: &AppState) -> Result<PgPool, ApiError> {
    state
        .db
        .clone()
        .ok_or_else(|| ApiError::ServiceUnavailable("database not configured".into()))
}

#[derive(Deserialize)]
struct CreateTileSet {
    name: String,
    slug: String,
    projection: Option<String>,
    tile_size: Option<i32>,
    min_zoom: Option<i32>,
    max_zoom: i32,
    tile_count: i32,
    size_bytes: i64,
    storage_path: String,
    public: Option<bool>,
}

#[derive(Deserialize)]
struct UpdateTileSet {
    name: Option<String>,
    public: Option<bool>,
}

#[derive(Serialize, sqlx::FromRow)]
struct TileSetRow {
    id: Uuid,
    user_id: Uuid,
    name: String,
    slug: String,
    projection: String,
    tile_size: i32,
    min_zoom: i32,
    max_zoom: i32,
    tile_count: i32,
    size_bytes: i64,
    storage_path: String,
    public: bool,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
struct ListTileSetsQuery {
    user_id: Option<Uuid>,
}

async fn create_tileset(
    State(state): State<AppState>,
    Claims(user): Claims,
    Json(body): Json<CreateTileSet>,
) -> Result<Response, ApiError> {
    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

    let projection = body.projection.as_deref().unwrap_or("flat");
    let tile_size = body.tile_size.unwrap_or(256);
    let min_zoom = body.min_zoom.unwrap_or(0);
    let public = body.public.unwrap_or(false);

    let row = sqlx::query_as::<_, TileSetRow>(
        "INSERT INTO tile_sets (user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public, created_at",
    )
    .bind(user_id)
    .bind(&body.name)
    .bind(&body.slug)
    .bind(projection)
    .bind(tile_size)
    .bind(min_zoom)
    .bind(body.max_zoom)
    .bind(body.tile_count)
    .bind(body.size_bytes)
    .bind(&body.storage_path)
    .bind(public)
    .fetch_one(&db)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref db_err) = e {
            if db_err.constraint() == Some("tile_sets_user_id_slug_key") {
                return ApiError::Conflict("a tile set with this slug already exists".into());
            }
        }
        ApiError::Db(e.to_string())
    })?;

    Ok((StatusCode::CREATED, Json(row)).into_response())
}

async fn list_tilesets(
    State(state): State<AppState>,
    claims: OptionalClaims,
    Query(params): Query<ListTileSetsQuery>,
) -> Result<Json<Vec<TileSetRow>>, ApiError> {
    let db = require_db(&state)?;

    // If authenticated and no explicit user_id filter, show the caller's tilesets
    let user_id = params
        .user_id
        .or_else(|| claims.0.as_ref().and_then(|c| Uuid::parse_str(&c.sub).ok()));

    let rows = if let Some(user_id) = user_id {
        sqlx::query_as::<_, TileSetRow>(
            "SELECT id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public, created_at
             FROM tile_sets WHERE user_id = $1 ORDER BY created_at DESC",
        )
        .bind(user_id)
        .fetch_all(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?
    } else {
        sqlx::query_as::<_, TileSetRow>(
            "SELECT id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public, created_at
             FROM tile_sets WHERE public = true ORDER BY created_at DESC",
        )
        .fetch_all(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?
    };

    Ok(Json(rows))
}

async fn get_tileset(
    State(state): State<AppState>,
    claims: OptionalClaims,
    Path(slug): Path<String>,
) -> Result<Json<TileSetRow>, ApiError> {
    let db = require_db(&state)?;

    let row = sqlx::query_as::<_, TileSetRow>(
        "SELECT id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public, created_at
         FROM tile_sets WHERE slug = $1",
    )
    .bind(&slug)
    .fetch_optional(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?
    .ok_or(ApiError::NotFound)?;

    // Private tilesets are only visible to their owner
    if !row.public {
        let is_owner = claims
            .0
            .as_ref()
            .and_then(|c| Uuid::parse_str(&c.sub).ok())
            .map(|uid| uid == row.user_id)
            .unwrap_or(false);
        if !is_owner {
            return Err(ApiError::NotFound);
        }
    }

    Ok(Json(row))
}

async fn update_tileset(
    State(state): State<AppState>,
    Claims(user): Claims,
    Path(slug): Path<String>,
    Json(body): Json<UpdateTileSet>,
) -> Result<Json<TileSetRow>, ApiError> {
    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

    let row = sqlx::query_as::<_, TileSetRow>(
        "UPDATE tile_sets
         SET name = COALESCE($1, name),
             public = COALESCE($2, public)
         WHERE slug = $3 AND user_id = $4
         RETURNING id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public, created_at",
    )
    .bind(&body.name)
    .bind(body.public)
    .bind(&slug)
    .bind(user_id)
    .fetch_optional(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?
    .ok_or(ApiError::NotFound)?;

    Ok(Json(row))
}

async fn delete_tileset(
    State(state): State<AppState>,
    Claims(user): Claims,
    Path(slug): Path<String>,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

    // Fetch the tileset first so we can get its storage_path for S3 cleanup
    let row = sqlx::query_as::<_, TileSetRow>(
        "SELECT id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public, created_at
         FROM tile_sets WHERE slug = $1 AND user_id = $2",
    )
    .bind(&slug)
    .bind(user_id)
    .fetch_optional(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?
    .ok_or(ApiError::NotFound)?;

    sqlx::query("DELETE FROM tile_sets WHERE slug = $1 AND user_id = $2")
        .bind(&slug)
        .bind(user_id)
        .execute(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    // Clean up S3 objects if bucket is configured
    if let Some(ref bucket) = state.bucket {
        let storage_path = &row.storage_path;
        let _ = bucket.delete_object(&format!("{storage_path}/tiles.zip")).await;
        let _ = bucket.delete_object(&format!("{storage_path}/tiles.pmtiles")).await;
        tracing::info!(slug = %slug, "deleted S3 objects for tileset");
    }

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct UserResponse {
    id: String,
    plan: String,
}

async fn get_current_user(Claims(user): Claims) -> Json<UserResponse> {
    Json(UserResponse {
        id: user.sub,
        plan: user.plan,
    })
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

    // Connect to Postgres if configured
    let db = if let Some(ref url) = config.database_url {
        match sqlx::postgres::PgPoolOptions::new()
            .max_connections(10)
            .connect(url)
            .await
        {
            Ok(pool) => {
                tracing::info!("connected to Postgres");
                if let Err(e) = sqlx::migrate!().run(&pool).await {
                    tracing::error!("failed to run migrations: {e}");
                    None
                } else {
                    tracing::info!("migrations applied");
                    Some(pool)
                }
            }
            Err(e) => {
                tracing::warn!("failed to connect to Postgres: {e} — DB features disabled");
                None
            }
        }
    } else {
        tracing::info!("DATABASE_URL not set — DB features disabled");
        None
    };

    // Initialize S3 bucket if configured
    let bucket = s3::bucket_from_env();
    tracing::info!("S3: {}", if bucket.is_some() { "configured" } else { "not configured" });

    let state = AppState {
        max_upload_bytes: config.max_upload_bytes,
        redis: redis.clone(),
        bucket: bucket.map(Arc::from),
        db,
        jwt_secret: config.jwt_secret,
    };

    let rate_limit = RateLimit { redis };

    let cors = match config.cors_origin {
        Some(ref origin) => {
            tracing::info!("CORS origin: {origin}");
            CorsLayer::new()
                .allow_origin(origin.parse::<HeaderValue>().expect("invalid CORS_ORIGIN"))
                .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE, Method::OPTIONS])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
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
            post(process_tiles)
                .layer(DefaultBodyLimit::max(config.max_upload_bytes))
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_tiles)),
        )
        .route(
            "/api/tiles/{job_id}/progress",
            get(job_progress)
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_progress)),
        )
        .route(
            "/api/tiles/{job_id}/download",
            get(job_download)
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_download)),
        )
        .route(
            "/api/tiles/{job_id}/download/pmtiles",
            get(job_download_pmtiles)
                .layer(middleware::from_fn_with_state(rate_limit, rate_limit_download)),
        )
        .route("/api/user", get(get_current_user))
        .route("/api/tilesets", post(create_tileset).get(list_tilesets))
        .route(
            "/api/tilesets/{slug}",
            get(get_tileset).patch(update_tileset).delete(delete_tileset),
        )
        .layer(middleware::from_fn_with_state(state.clone(), optional_auth))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .unwrap();
}
