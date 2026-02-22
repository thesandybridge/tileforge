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
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use rand::Rng;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use sqlx::PgPool;
use std::io::Cursor;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tileforge_core::{streaming::should_use_streaming, Projection, TileConfig, Tiler, ZipTileWriter, STREAMING_THRESHOLD};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

/// 5 GB storage quota for Pro users.
const QUOTA_PRO_BYTES: i64 = 5 * 1024 * 1024 * 1024;
const PRESIGN_TTL_SECS: u32 = 600; // 10 minutes

// ---------------------------------------------------------------------------
// OpenAPI documentation
// ---------------------------------------------------------------------------

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Tileforge API",
        description = "REST API for processing images into XYZ map tiles",
        version = "0.1.0",
        license(name = "MIT", url = "https://github.com/thesandybridge/tileforge/blob/main/LICENSE")
    ),
    tags(
        (name = "Health", description = "Health check endpoints"),
        (name = "Tiles", description = "Tile processing and download"),
        (name = "Tilesets", description = "Tileset CRUD operations"),
        (name = "User", description = "User account management"),
        (name = "Notifications", description = "In-app notifications"),
        (name = "API Keys", description = "API key management (Pro only)")
    ),
    paths(
        health,
        process_tiles,
        get_current_user,
        list_tilesets,
        get_tileset
    ),
    components(
        schemas(
            ErrorBody,
            AcceptedResponse,
            Plan,
            UserResponse,
            TileSetRow,
            ApiKeyRow,
            ApiKeyCreatedResponse,
            NotificationRow
        )
    )
)]
struct ApiDoc;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

struct AppConfig {
    port: u16,
    max_upload_bytes: usize,
    redis_url: Option<String>,
    nats_url: Option<String>,
    cors_origin: Option<String>,
    database_url: Option<String>,
    jwt_secret: Option<String>,
    admin_secret: Option<String>,
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
            nats_url: std::env::var("NATS_URL").ok(),
            cors_origin: std::env::var("CORS_ORIGIN").ok(),
            database_url: std::env::var("DATABASE_URL").ok(),
            jwt_secret: std::env::var("JWT_SECRET").ok(),
            admin_secret: std::env::var("ADMIN_SECRET").ok(),
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
    nats: Option<async_nats::jetstream::Context>,
    bucket: Option<Arc<s3::Bucket>>,
    db: Option<PgPool>,
    jwt_secret: Option<String>,
    admin_secret: Option<String>,
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
    Forbidden,
    ServiceUnavailable(String),
    Db(String),
    Conflict(String),
    QuotaExceeded,
    FormatRequiresPro(String),
}

#[derive(Serialize, utoipa::ToSchema)]
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
            ApiError::Db(msg) => {
                tracing::error!("database error: {msg}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal server error".into())
            }
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, msg),
            ApiError::QuotaExceeded => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "storage quota exceeded (5 GB limit)".into(),
            ),
            ApiError::FormatRequiresPro(fmt) => (
                StatusCode::FORBIDDEN,
                format!("{fmt} format requires a Pro plan"),
            ),
        };
        (status, Json(ErrorBody { error: message })).into_response()
    }
}

// ---------------------------------------------------------------------------
// JWT auth
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
enum Plan {
    Free,
    Pro,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct UserClaims {
    sub: String,
    plan: Plan,
    iat: Option<u64>,
    exp: Option<u64>,
}

/// Middleware: extract Bearer token, validate JWT, inject UserClaims into extensions.
/// Supports three auth paths:
/// 1. JWT Bearer token (Authorization: Bearer <jwt>)
/// 2. API key as Bearer token (Authorization: Bearer tf_...)
/// 3. API key as query parameter (?key=tf_...)
async fn optional_auth(
    State(state): State<AppState>,
    mut req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    // Extract bearer token if present
    let bearer_token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    // Path 1: JWT from Bearer token
    if let (Some(ref secret), Some(ref token)) = (&state.jwt_secret, &bearer_token) {
        let key = DecodingKey::from_secret(secret.as_bytes());
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_required_spec_claims(&["sub", "exp"]);
        if let Ok(data) = decode::<UserClaims>(token, &key, &validation) {
            // Verify user is not deactivated before accepting JWT claims
            let mut is_active = true;
            if let Some(ref db) = state.db {
                if let Ok(user_id) = Uuid::parse_str(&data.claims.sub) {
                    let deactivated: Option<(bool,)> = sqlx::query_as(
                        "SELECT deactivated_at IS NOT NULL FROM users WHERE id = $1",
                    )
                    .bind(user_id)
                    .fetch_optional(db)
                    .await
                    .ok()
                    .flatten();
                    if let Some((true,)) = deactivated {
                        is_active = false;
                    }
                }
            }
            if is_active {
                req.extensions_mut().insert(data.claims);
            }
        }
    }

    // Path 2: API key as Bearer token (Authorization: Bearer tf_...)
    if req.extensions().get::<UserClaims>().is_none() {
        if let Some(ref token) = bearer_token {
            if token.starts_with("tf_") && token.len() == 35 {
                if let Some(ref db) = state.db {
                    if let Some(claims) = validate_api_key(db, token).await {
                        req.extensions_mut().insert(claims);
                    }
                }
            }
        }
    }

    // Path 3: API key query parameter (?key=tf_...)
    if req.extensions().get::<UserClaims>().is_none() {
        if let Some(ref db) = state.db {
            if let Some(api_key) = extract_api_key_from_query(req.uri()) {
                if let Some(claims) = validate_api_key(db, &api_key).await {
                    req.extensions_mut().insert(claims);
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

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<UserClaims>()
            .cloned()
            .map(Claims)
            .ok_or(ApiError::Unauthorized)
    }
}

/// Extractor: optionally authenticated user (None if absent).
struct OptionalClaims(Option<UserClaims>);

impl<S: Send + Sync> FromRequestParts<S> for OptionalClaims {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        Ok(OptionalClaims(parts.extensions.get::<UserClaims>().cloned()))
    }
}

// ---------------------------------------------------------------------------
// API key helpers
// ---------------------------------------------------------------------------

fn extract_api_key_from_query(uri: &axum::http::Uri) -> Option<String> {
    let query = uri.query()?;
    for pair in query.split('&') {
        if let Some(val) = pair.strip_prefix("key=") {
            if val.starts_with("tf_") && val.len() == 35 {
                return Some(val.to_string());
            }
        }
    }
    None
}

async fn validate_api_key(db: &PgPool, raw_key: &str) -> Option<UserClaims> {
    let hash = hex::encode(Sha256::digest(raw_key.as_bytes()));
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT u.id::text, u.plan
         FROM api_keys ak JOIN users u ON u.id = ak.user_id
         WHERE ak.key_hash = $1 AND ak.revoked_at IS NULL AND u.deactivated_at IS NULL",
    )
    .bind(&hash)
    .fetch_optional(db)
    .await
    .ok()?;

    let (user_id, plan_str) = row?;
    let plan = match plan_str.as_str() {
        "pro" => Plan::Pro,
        _ => Plan::Free,
    };
    Some(UserClaims {
        sub: user_id,
        plan,
        iat: None,
        exp: None,
    })
}

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

#[derive(Deserialize, utoipa::IntoParams)]
struct TileParams {
    tile_size: Option<u32>,
    min_zoom: Option<u32>,
    max_zoom: Option<u32>,
    projection: Option<String>,
    file_name: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reserved_bytes: Option<i64>,
}

#[derive(Serialize, utoipa::ToSchema)]
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

/// Rate limit info returned on successful check
#[derive(Clone, Copy)]
struct RateLimitInfo {
    limit: u64,
    remaining: u64,
    reset: u64,
}

/// Rate limit tiers based on user plan
#[derive(Clone, Copy)]
struct RateLimitTier {
    anonymous: u64,
    free: u64,
    pro: u64,
}

impl RateLimitTier {
    const fn get(&self, plan: Option<Plan>) -> u64 {
        match plan {
            None => self.anonymous,
            Some(Plan::Free) => self.free,
            Some(Plan::Pro) => self.pro,
        }
    }
}

// Rate limit tiers per endpoint (requests per minute)
const TIER_TILES: RateLimitTier = RateLimitTier { anonymous: 5, free: 10, pro: 60 };
const TIER_PROGRESS: RateLimitTier = RateLimitTier { anonymous: 30, free: 60, pro: 300 };
const TIER_DOWNLOAD: RateLimitTier = RateLimitTier { anonymous: 15, free: 30, pro: 120 };
const TIER_MUTATIONS: RateLimitTier = RateLimitTier { anonymous: 10, free: 30, pro: 120 };

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
    /// Check rate limit with user-aware tiering.
    /// Uses user_id as key if authenticated, otherwise falls back to IP.
    /// Applies different limits based on plan (anonymous < free < pro).
    async fn check_tiered(
        &self,
        ip: &str,
        user: Option<&UserClaims>,
        endpoint: &str,
        tier: RateLimitTier,
        window_secs: u64,
    ) -> Result<RateLimitInfo, Response> {
        let plan = user.map(|u| u.plan);
        let max_requests = tier.get(plan);

        // Use user ID if authenticated, otherwise IP
        let identity = match user {
            Some(u) => format!("user:{}", u.sub),
            None => format!("ip:{}", ip),
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let window = now / window_secs;
        let reset = (window + 1) * window_secs;

        let mut conn = match self.redis {
            Some(ref c) => c.clone(),
            None => {
                // No Redis = no rate limiting, return unlimited
                return Ok(RateLimitInfo {
                    limit: max_requests,
                    remaining: max_requests,
                    reset,
                });
            }
        };

        let key = format!("ratelimit:{identity}:{endpoint}:{window}");

        let count: u64 = match conn.incr(&key, 1u64).await {
            Ok(c) => c,
            Err(_) => {
                // Redis error = fail open
                return Ok(RateLimitInfo {
                    limit: max_requests,
                    remaining: max_requests,
                    reset,
                });
            }
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
                [
                    (header::RETRY_AFTER, retry_after.to_string().parse::<HeaderValue>().unwrap()),
                    ("X-RateLimit-Limit".parse().unwrap(), max_requests.to_string().parse().unwrap()),
                    ("X-RateLimit-Remaining".parse().unwrap(), "0".parse().unwrap()),
                    ("X-RateLimit-Reset".parse().unwrap(), reset.to_string().parse().unwrap()),
                ],
                Json(body),
            )
                .into_response());
        }

        Ok(RateLimitInfo {
            limit: max_requests,
            remaining: max_requests.saturating_sub(count),
            reset,
        })
    }
}

/// Helper to inject rate limit headers into a response
fn inject_rate_limit_headers(mut response: Response, info: RateLimitInfo) -> Response {
    let headers = response.headers_mut();
    if let Ok(v) = info.limit.to_string().parse() {
        headers.insert("X-RateLimit-Limit", v);
    }
    if let Ok(v) = info.remaining.to_string().parse() {
        headers.insert("X-RateLimit-Remaining", v);
    }
    if let Ok(v) = info.reset.to_string().parse() {
        headers.insert("X-RateLimit-Reset", v);
    }
    response
}

async fn rate_limit_tiles(
    State(rl): State<RateLimit>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let ip = extract_client_ip(&req, Some(addr));
    let user = req.extensions().get::<UserClaims>().cloned();
    let info = match rl.check_tiered(&ip, user.as_ref(), "post_tiles", TIER_TILES, 60).await {
        Ok(info) => info,
        Err(resp) => return resp,
    };
    inject_rate_limit_headers(next.run(req).await, info)
}

async fn rate_limit_progress(
    State(rl): State<RateLimit>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let ip = extract_client_ip(&req, Some(addr));
    let user = req.extensions().get::<UserClaims>().cloned();
    let info = match rl.check_tiered(&ip, user.as_ref(), "progress", TIER_PROGRESS, 60).await {
        Ok(info) => info,
        Err(resp) => return resp,
    };
    inject_rate_limit_headers(next.run(req).await, info)
}

async fn rate_limit_download(
    State(rl): State<RateLimit>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let ip = extract_client_ip(&req, Some(addr));
    let user = req.extensions().get::<UserClaims>().cloned();
    let info = match rl.check_tiered(&ip, user.as_ref(), "download", TIER_DOWNLOAD, 60).await {
        Ok(info) => info,
        Err(resp) => return resp,
    };
    inject_rate_limit_headers(next.run(req).await, info)
}

async fn rate_limit_mutations(
    State(rl): State<RateLimit>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let ip = extract_client_ip(&req, Some(addr));
    let user = req.extensions().get::<UserClaims>().cloned();
    let info = match rl.check_tiered(&ip, user.as_ref(), "mutations", TIER_MUTATIONS, 60).await {
        Ok(info) => info,
        Err(resp) => return resp,
    };
    inject_rate_limit_headers(next.run(req).await, info)
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/health",
    tag = "Health",
    responses(
        (status = 200, description = "Service is healthy", body = String)
    )
)]
async fn health() -> &'static str {
    "ok"
}

#[utoipa::path(
    post,
    path = "/api/tiles",
    tag = "Tiles",
    params(TileParams),
    request_body(content = Vec<u8>, content_type = "application/octet-stream", description = "Image bytes"),
    responses(
        (status = 200, description = "Tiles processed (sync)", content_type = "application/zip"),
        (status = 202, description = "Job queued for async processing", body = AcceptedResponse),
        (status = 400, description = "Invalid input", body = ErrorBody),
        (status = 429, description = "Rate limit exceeded", body = ErrorBody)
    )
)]
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
        "isometric" => Projection::Isometric,
        "flat" => Projection::Flat,
        _ => {
            return Err(ApiError::InvalidField(
                "projection must be 'flat', 'mercator', or 'isometric'".into(),
            ))
        }
    };

    let min_zoom = params.min_zoom;
    let max_zoom = params.max_zoom;

    // Cap max_zoom to prevent DoS (z=12 → ~16M tiles max)
    const MAX_ZOOM_LIMIT: u32 = 12;
    if let Some(mz) = max_zoom {
        if mz > MAX_ZOOM_LIMIT {
            return Err(ApiError::InvalidField(
                format!("max_zoom cannot exceed {MAX_ZOOM_LIMIT}"),
            ));
        }
    }

    // Authenticated users (pro/server mode) always use async path;
    // anonymous users only go async for large images.
    let is_pro = claims.0.as_ref().is_some_and(|c| c.plan == Plan::Pro);

    if tileforge_core::is_tiff(&body) && !is_pro {
        return Err(ApiError::FormatRequiresPro("TIFF/GeoTIFF".into()));
    }

    let is_large = should_use_streaming(&body, STREAMING_THRESHOLD);

    // Atomic storage reservation for Pro users (prevents TOCTOU race)
    // Estimate output size as 2x input size (conservative for tiles + PMTiles)
    let reserved_bytes: Option<i64> = if is_pro {
        if let Some(ref db) = state.db {
            let user_id = Uuid::parse_str(&claims.0.as_ref().unwrap().sub)
                .map_err(|_| ApiError::Unauthorized)?;
            let estimate = (body.len() as i64) * 2;
            let reserved: Option<(bool,)> = sqlx::query_as(
                "SELECT reserve_storage($1, $2, $3)",
            )
            .bind(user_id)
            .bind(estimate)
            .bind(QUOTA_PRO_BYTES)
            .fetch_optional(db)
            .await
            .map_err(|e| ApiError::Db(e.to_string()))?;
            if reserved.map(|r| r.0).unwrap_or(false) {
                Some(estimate)
            } else {
                return Err(ApiError::QuotaExceeded);
            }
        } else {
            None
        }
    } else {
        None
    };

    if is_pro || is_large {
        // Async path: upload to S3, enqueue via NATS JetStream (or Redis fallback)
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
            "user_id": claims.0.as_ref().map(|c| &c.sub),
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
            file_name: params.file_name.clone(),
            reserved_bytes,
        };
        let job_json = serde_json::to_string(&job).unwrap();

        if let Some(ref nats) = state.nats {
            // NATS JetStream: awaits PubAck for durable write confirmation
            nats.publish("tileforge.jobs", job_json.into())
                .await
                .map_err(|e| ApiError::Processing(format!("NATS publish failed: {e}")))?
                .await
                .map_err(|e| ApiError::Processing(format!("NATS publish ack failed: {e}")))?;
            tracing::info!(job_id = %job_id, "enqueued async job via NATS");
        } else {
            // Fallback: Redis LPUSH (no delivery guarantees)
            let _: redis::RedisResult<()> = redis.lpush("tileforge:jobs", &job_json).await;
            tracing::info!(job_id = %job_id, "enqueued async job via Redis (NATS not configured)");
        }

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
            scale: None,
            background: None,
            scale_metadata: None,
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

/// Verify the authenticated user owns this job (via the user_id stored in Redis progress).
async fn verify_job_owner(redis: &mut redis::aio::MultiplexedConnection, job_id: &str, user: &UserClaims) -> Result<(), ApiError> {
    let key = format!("tileforge:progress:{job_id}");
    let val: Option<String> = redis.get(&key).await.ok().flatten();
    if let Some(json) = val {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&json) {
            if let Some(owner_id) = data.get("user_id").and_then(|v| v.as_str()) {
                if owner_id != user.sub {
                    return Err(ApiError::NotFound);
                }
            }
        }
    }
    Ok(())
}

async fn job_download(
    Claims(user): Claims,
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Response, ApiError> {
    if let Some(ref redis) = state.redis {
        verify_job_owner(&mut redis.clone(), &job_id, &user).await?;
    }

    let bucket = state
        .bucket
        .as_ref()
        .ok_or_else(|| ApiError::ServiceUnavailable("S3 not configured".into()))?;

    let s3_key = format!("tiles/{job_id}/tiles.zip");

    // Proxy S3 response instead of redirecting (avoids leaking presigned URLs)
    let response = bucket
        .get_object(&s3_key)
        .await
        .map_err(|_| ApiError::NotFound)?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"tiles.zip\""),
        ],
        response.to_vec(),
    )
        .into_response())
}

async fn job_thumbnail(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Response, ApiError> {
    let bucket = state
        .bucket
        .as_ref()
        .ok_or_else(|| ApiError::ServiceUnavailable("S3 not configured".into()))?;

    let s3_key = format!("tiles/{job_id}/thumbnail.jpg");
    let resp = bucket
        .get_object(&s3_key)
        .await
        .map_err(|_| ApiError::NotFound)?;

    let bytes = resp.to_vec();
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static("image/jpeg")),
            (header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=86400")),
            (header::CONTENT_LENGTH, HeaderValue::from_str(&bytes.len().to_string()).unwrap()),
        ],
        bytes,
    )
        .into_response())
}

async fn job_download_pmtiles(
    Claims(user): Claims,
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Response, ApiError> {
    if let Some(ref redis) = state.redis {
        verify_job_owner(&mut redis.clone(), &job_id, &user).await?;
    }

    let bucket = state
        .bucket
        .as_ref()
        .ok_or_else(|| ApiError::ServiceUnavailable("S3 not configured".into()))?;

    let s3_key = format!("tiles/{job_id}/tiles.pmtiles");

    // Proxy S3 response instead of redirecting (avoids leaking presigned URLs)
    let response = bucket
        .get_object(&s3_key)
        .await
        .map_err(|_| ApiError::NotFound)?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"tiles.pmtiles\""),
        ],
        response.to_vec(),
    )
        .into_response())
}

// ---------------------------------------------------------------------------
// Tile set CRUD
// ---------------------------------------------------------------------------

async fn get_storage_used(db: &PgPool, user_id: Uuid) -> Result<i64, ApiError> {
    // Use denormalized storage_used_bytes column (maintained by trigger)
    let row: (i64,) =
        sqlx::query_as("SELECT storage_used_bytes FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(db)
            .await
            .map_err(|e| ApiError::Db(e.to_string()))?;
    Ok(row.0)
}

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

#[derive(Serialize, sqlx::FromRow, utoipa::ToSchema)]
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
    width: Option<i32>,
    height: Option<i32>,
}

#[derive(Deserialize, utoipa::IntoParams)]
struct ListTileSetsQuery {
    user_id: Option<Uuid>,
    page: Option<i64>,
    per_page: Option<i64>,
    search: Option<String>,
}

fn pagination(page: Option<i64>, per_page: Option<i64>) -> (i64, i64) {
    let per_page = per_page.unwrap_or(50).clamp(1, 100);
    let page = page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;
    (per_page, offset)
}

async fn create_tileset(
    State(state): State<AppState>,
    Claims(user): Claims,
    Json(body): Json<CreateTileSet>,
) -> Result<Response, ApiError> {
    if body.name.is_empty() || body.name.len() > 200 {
        return Err(ApiError::InvalidField("name must be 1-200 characters".into()));
    }
    if body.slug.is_empty() || body.slug.len() > 100 {
        return Err(ApiError::InvalidField("slug must be 1-100 characters".into()));
    }

    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

    let projection = body.projection.as_deref().unwrap_or("flat");
    let tile_size = body.tile_size.unwrap_or(256);
    let min_zoom = body.min_zoom.unwrap_or(0);
    let public = body.public.unwrap_or(false);

    let row = sqlx::query_as::<_, TileSetRow>(
        "INSERT INTO tile_sets (user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public, created_at, width, height",
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

#[utoipa::path(
    get,
    path = "/api/tilesets",
    tag = "Tilesets",
    params(ListTileSetsQuery),
    responses(
        (status = 200, description = "List of tilesets", body = Vec<TileSetRow>)
    )
)]
async fn list_tilesets(
    State(state): State<AppState>,
    claims: OptionalClaims,
    Query(params): Query<ListTileSetsQuery>,
) -> Result<Json<Vec<TileSetRow>>, ApiError> {
    let db = require_db(&state)?;

    // Determine whose tilesets to show and whether to include private ones
    let caller_id = claims.0.as_ref().and_then(|c| Uuid::parse_str(&c.sub).ok());
    let target_user_id = params.user_id.or(caller_id);

    let (limit, offset) = pagination(params.page, params.per_page);
    let search_pattern = params.search.as_ref().map(|s| {
        // Escape LIKE wildcards to prevent injection
        let escaped = s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        format!("%{}%", escaped)
    });

    // Build dynamic query to avoid duplicating 8 SQL variants
    let is_owner = target_user_id
        .map(|uid| caller_id.map(|c| c == uid).unwrap_or(false))
        .unwrap_or(false);

    let rows: Vec<TileSetRow> = sqlx::query_as(
        r#"SELECT id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom,
                  tile_count, size_bytes, storage_path, public, created_at, width, height
           FROM tile_sets
           WHERE ($1::uuid IS NULL OR user_id = $1)
             AND ($2 OR public = true)
             AND ($3::text IS NULL OR name ILIKE $3)
           ORDER BY created_at DESC
           LIMIT $4 OFFSET $5"#,
    )
    .bind(target_user_id)
    .bind(is_owner)
    .bind(search_pattern)
    .bind(limit)
    .bind(offset)
    .fetch_all(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    Ok(Json(rows))
}

#[utoipa::path(
    get,
    path = "/api/tilesets/{slug}",
    tag = "Tilesets",
    params(
        ("slug" = String, Path, description = "Tileset slug")
    ),
    responses(
        (status = 200, description = "Tileset details", body = TileSetRow),
        (status = 404, description = "Tileset not found", body = ErrorBody)
    )
)]
async fn get_tileset(
    State(state): State<AppState>,
    claims: OptionalClaims,
    Path(slug): Path<String>,
) -> Result<Json<TileSetRow>, ApiError> {
    let db = require_db(&state)?;

    let row = sqlx::query_as::<_, TileSetRow>(
        "SELECT id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public, created_at, width, height
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
         RETURNING id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public, created_at, width, height",
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
        "SELECT id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public, created_at, width, height
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
        let _ = bucket.delete_object(&format!("{storage_path}/thumbnail.jpg")).await;
        tracing::info!(slug = %slug, "deleted S3 objects for tileset");
    }

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

#[derive(Serialize, utoipa::ToSchema)]
struct UserResponse {
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
        (status = 401, description = "Unauthorized", body = ErrorBody)
    )
)]
async fn get_current_user(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<Json<UserResponse>, ApiError> {
    let (storage_used, storage_quota) = if user.plan == Plan::Pro {
        if let Some(ref db) = state.db {
            let uid = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;
            let used = get_storage_used(db, uid).await?;
            (used, QUOTA_PRO_BYTES)
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

// ---------------------------------------------------------------------------
// API key management
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow, utoipa::ToSchema)]
struct ApiKeyRow {
    id: Uuid,
    key_prefix: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize, utoipa::ToSchema)]
struct ApiKeyCreatedResponse {
    id: Uuid,
    key: String,
    key_prefix: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

async fn create_api_key(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<Response, ApiError> {
    if user.plan != Plan::Pro {
        return Err(ApiError::Forbidden);
    }
    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

    // Generate key: tf_ + 32 hex chars (16 random bytes)
    let random_bytes: [u8; 16] = rand::thread_rng().gen();
    let raw_key = format!("tf_{}", hex::encode(random_bytes));
    let key_hash = hex::encode(Sha256::digest(raw_key.as_bytes()));
    let key_prefix = raw_key[..11].to_string(); // "tf_" + 8 hex chars

    let mut tx = db.begin().await.map_err(|e| ApiError::Db(e.to_string()))?;

    // Revoke any existing active key
    sqlx::query("UPDATE api_keys SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    // Insert new key
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

async fn get_api_key(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<Response, ApiError> {
    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

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

async fn revoke_api_key(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

    sqlx::query("UPDATE api_keys SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow, utoipa::ToSchema)]
struct NotificationRow {
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
struct CreateNotificationBody {
    #[serde(rename = "type")]
    notification_type: String,
    title: String,
    message: Option<String>,
    link: Option<String>,
}

async fn list_notifications(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<Json<Vec<NotificationRow>>, ApiError> {
    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

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

async fn create_notification(
    State(state): State<AppState>,
    Claims(user): Claims,
    Json(body): Json<CreateNotificationBody>,
) -> Result<Response, ApiError> {
    if body.notification_type.len() > 50 {
        return Err(ApiError::InvalidField("type must be 50 characters or fewer".into()));
    }
    if body.title.len() > 200 {
        return Err(ApiError::InvalidField("title must be 200 characters or fewer".into()));
    }
    if body.message.as_ref().is_some_and(|m| m.len() > 1000) {
        return Err(ApiError::InvalidField("message must be 1000 characters or fewer".into()));
    }

    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

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

async fn mark_notifications_read(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

    sqlx::query("UPDATE notifications SET read = true WHERE user_id = $1 AND read = false")
        .bind(user_id)
        .execute(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

async fn clear_notifications(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

    sqlx::query("DELETE FROM notifications WHERE user_id = $1")
        .bind(user_id)
        .execute(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Broadcast notification (admin)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct BroadcastResponse {
    notified: i64,
}

async fn broadcast_notification(
    State(state): State<AppState>,
    req: Request<axum::body::Body>,
) -> Result<Json<BroadcastResponse>, ApiError> {
    let admin_secret = state
        .admin_secret
        .as_ref()
        .ok_or(ApiError::Forbidden)?;

    let auth_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized)?;

    if auth_header != admin_secret {
        return Err(ApiError::Forbidden);
    }

    let body_bytes = axum::body::to_bytes(req.into_body(), 1024 * 64)
        .await
        .map_err(|_| ApiError::InvalidField("invalid request body".into()))?;
    let body: CreateNotificationBody = serde_json::from_slice(&body_bytes)
        .map_err(|e| ApiError::InvalidField(format!("invalid JSON: {e}")))?;

    if body.notification_type.len() > 50 {
        return Err(ApiError::InvalidField("type must be 50 characters or fewer".into()));
    }
    if body.title.len() > 200 {
        return Err(ApiError::InvalidField("title must be 200 characters or fewer".into()));
    }

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

// ---------------------------------------------------------------------------
// PMTiles presigned URL (for range-request preview)
// ---------------------------------------------------------------------------

async fn tileset_pmtiles_url(
    State(state): State<AppState>,
    claims: OptionalClaims,
    Path(slug): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = require_db(&state)?;
    let bucket = state
        .bucket
        .as_ref()
        .ok_or_else(|| ApiError::ServiceUnavailable("S3 not configured".into()))?;

    let row = sqlx::query_as::<_, TileSetRow>(
        "SELECT id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public, created_at, width, height
         FROM tile_sets WHERE slug = $1",
    )
    .bind(&slug)
    .fetch_optional(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?
    .ok_or(ApiError::NotFound)?;

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

    let s3_key = format!("{}/tiles.pmtiles", row.storage_path);
    let url = bucket
        .presign_get(&s3_key, PRESIGN_TTL_SECS, None)
        .await
        .map_err(|_| ApiError::NotFound)?;

    Ok(Json(serde_json::json!({ "url": url })))
}

// ---------------------------------------------------------------------------
// Account deactivation
// ---------------------------------------------------------------------------

async fn deactivate_user(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

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

async fn reactivate_user(
    State(state): State<AppState>,
    Claims(user): Claims,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;

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

#[derive(Serialize)]
struct PurgeResponse {
    deleted: u64,
}

async fn purge_deactivated(
    State(state): State<AppState>,
    req: Request<axum::body::Body>,
) -> Result<Json<PurgeResponse>, ApiError> {
    // Verify ADMIN_SECRET
    let admin_secret = state
        .admin_secret
        .as_ref()
        .ok_or(ApiError::Forbidden)?;

    let auth_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized)?;

    if auth_header != admin_secret {
        return Err(ApiError::Forbidden);
    }

    let db = require_db(&state)?;

    // Find users deactivated more than 30 days ago
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

    // Batch fetch all storage paths for S3 cleanup (single query)
    let tilesets: Vec<(String,)> = sqlx::query_as(
        "SELECT storage_path FROM tile_sets WHERE user_id = ANY($1::uuid[])",
    )
    .bind(&user_ids)
    .fetch_all(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    // Delete S3 objects (can't batch S3 deletes, but we've reduced DB queries)
    if let Some(ref bucket) = state.bucket {
        for (storage_path,) in &tilesets {
            let _ = bucket.delete_object(&format!("{storage_path}/tiles.zip")).await;
            let _ = bucket.delete_object(&format!("{storage_path}/tiles.pmtiles")).await;
            let _ = bucket.delete_object(&format!("{storage_path}/thumbnail.jpg")).await;
        }
    }

    // Batch delete all users (CASCADE handles tile_sets and api_keys)
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

    // Connect to NATS JetStream if configured
    let nats = if let Some(ref url) = config.nats_url {
        match async_nats::connect(url).await {
            Ok(client) => {
                let js = async_nats::jetstream::new(client);
                // Create (or reuse) the durable job stream
                match js.get_or_create_stream(async_nats::jetstream::stream::Config {
                    name: "TILEFORGE_JOBS".into(),
                    subjects: vec!["tileforge.jobs".into()],
                    retention: async_nats::jetstream::stream::RetentionPolicy::WorkQueue,
                    max_age: std::time::Duration::from_secs(86400),
                    storage: async_nats::jetstream::stream::StorageType::File,
                    ..Default::default()
                }).await {
                    Ok(_) => tracing::info!("NATS JetStream stream TILEFORGE_JOBS ready"),
                    Err(e) => tracing::warn!("failed to create NATS stream: {e}"),
                }
                // Create DLQ stream for messages that exceed max_deliver
                match js.get_or_create_stream(async_nats::jetstream::stream::Config {
                    name: "TILEFORGE_DLQ".into(),
                    subjects: vec!["$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.TILEFORGE_JOBS.>".into()],
                    max_age: std::time::Duration::from_secs(7 * 86400),
                    storage: async_nats::jetstream::stream::StorageType::File,
                    ..Default::default()
                }).await {
                    Ok(_) => tracing::info!("NATS DLQ stream TILEFORGE_DLQ ready"),
                    Err(e) => tracing::warn!("failed to create NATS DLQ stream: {e}"),
                }
                tracing::info!("connected to NATS");
                Some(js)
            }
            Err(e) => {
                tracing::warn!("failed to connect to NATS: {e} — NATS job queue disabled");
                None
            }
        }
    } else {
        tracing::info!("NATS_URL not set — NATS job queue disabled");
        None
    };

    // Initialize S3 bucket if configured
    let bucket = s3::bucket_from_env();
    tracing::info!("S3: {}", if bucket.is_some() { "configured" } else { "not configured" });
    tracing::info!("JWT: {}", if config.jwt_secret.is_some() { "configured" } else { "not configured (auth disabled)" });

    let state = AppState {
        max_upload_bytes: config.max_upload_bytes,
        redis: redis.clone(),
        nats,
        bucket: bucket.map(Arc::from),
        db,
        jwt_secret: config.jwt_secret,
        admin_secret: config.admin_secret,
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
            tracing::warn!("CORS_ORIGIN not set — allowing all origins (set CORS_ORIGIN in production!)");
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
            "/api/tiles/{job_id}/thumbnail",
            get(job_thumbnail)
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_download)),
        )
        .route(
            "/api/tiles/{job_id}/download/pmtiles",
            get(job_download_pmtiles)
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_download)),
        )
        .route("/api/user", get(get_current_user))
        .route(
            "/api/user/deactivate",
            post(deactivate_user)
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_mutations)),
        )
        .route(
            "/api/user/reactivate",
            post(reactivate_user)
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_mutations)),
        )
        .route("/api/admin/purge-deactivated", post(purge_deactivated))
        .route("/api/admin/broadcast-notification", post(broadcast_notification))
        .route(
            "/api/notifications",
            get(list_notifications).post(create_notification).delete(clear_notifications)
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_mutations)),
        )
        .route(
            "/api/notifications/read",
            post(mark_notifications_read)
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_mutations)),
        )
        .route(
            "/api/keys",
            post(create_api_key).get(get_api_key).delete(revoke_api_key)
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_mutations)),
        )
        .route(
            "/api/tilesets",
            post(create_tileset).get(list_tilesets)
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_mutations)),
        )
        .route(
            "/api/tilesets/{slug}",
            get(get_tileset).patch(update_tileset).delete(delete_tileset)
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_mutations)),
        )
        .route(
            "/api/tilesets/{slug}/pmtiles-url",
            get(tileset_pmtiles_url)
                .layer(middleware::from_fn_with_state(rate_limit.clone(), rate_limit_download)),
        )
        .layer(middleware::from_fn_with_state(state.clone(), optional_auth))
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
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
