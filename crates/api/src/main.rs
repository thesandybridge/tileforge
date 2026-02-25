mod auth;
mod config;
mod error;
mod handlers;
mod rate_limit;
mod state;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::DefaultBodyLimit,
    http::{header, HeaderValue, Method},
    middleware,
    routing::{get, post},
    Router,
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::config::AppConfig;
use crate::rate_limit::RateLimit;
use crate::state::AppState;

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
        handlers::health,
        handlers::tiles::process_tiles,
        handlers::user::get_current_user,
        handlers::tilesets::list_tilesets,
        handlers::tilesets::get_tileset
    ),
    components(
        schemas(
            error::ErrorBody,
            handlers::tiles::AcceptedResponse,
            auth::Plan,
            handlers::user::UserResponse,
            handlers::tilesets::TileSetRow,
            handlers::api_keys::ApiKeyRow,
            handlers::api_keys::ApiKeyCreatedResponse,
            handlers::notifications::NotificationRow
        )
    )
)]
struct ApiDoc;

// ---------------------------------------------------------------------------
// Service initialization
// ---------------------------------------------------------------------------

async fn init_redis(url: &str) -> Option<redis::aio::MultiplexedConnection> {
    match redis::Client::open(url) {
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
}

async fn init_postgres(url: &str) -> Option<sqlx::PgPool> {
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
}

async fn init_nats(url: &str) -> Option<async_nats::jetstream::Context> {
    match async_nats::connect(url).await {
        Ok(client) => {
            let js = async_nats::jetstream::new(client);

            use tileforge_shared::{NATS_STREAM_NAME, NATS_JOBS_SUBJECT};

            match js
                .get_or_create_stream(async_nats::jetstream::stream::Config {
                    name: NATS_STREAM_NAME.into(),
                    subjects: vec![NATS_JOBS_SUBJECT.into()],
                    retention: async_nats::jetstream::stream::RetentionPolicy::WorkQueue,
                    max_age: std::time::Duration::from_secs(86400),
                    storage: async_nats::jetstream::stream::StorageType::File,
                    ..Default::default()
                })
                .await
            {
                Ok(_) => tracing::info!("NATS JetStream stream {NATS_STREAM_NAME} ready"),
                Err(e) => tracing::warn!("failed to create NATS stream: {e}"),
            }

            match js
                .get_or_create_stream(async_nats::jetstream::stream::Config {
                    name: "TILEFORGE_DLQ".into(),
                    subjects: vec![
                        format!("$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.{NATS_STREAM_NAME}.>"),
                    ],
                    max_age: std::time::Duration::from_secs(7 * 86400),
                    storage: async_nats::jetstream::stream::StorageType::File,
                    ..Default::default()
                })
                .await
            {
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
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

fn build_router(state: AppState, rate_limit: RateLimit, config: &AppConfig) -> Router {
    use handlers::*;
    use rate_limit::*;

    let cors = match config.cors_origin {
        Some(ref origin) => {
            tracing::info!("CORS origin: {origin}");
            CorsLayer::new()
                .allow_origin(origin.parse::<HeaderValue>().expect("invalid CORS_ORIGIN"))
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PATCH,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
        }
        None => {
            tracing::warn!(
                "CORS_ORIGIN not set — allowing all origins (set CORS_ORIGIN in production!)"
            );
            CorsLayer::permissive()
        }
    };

    Router::new()
        // Health
        .route("/health", get(health))
        // Tile processing
        .route(
            "/api/tiles",
            post(tiles::process_tiles)
                .layer(DefaultBodyLimit::max(config.max_upload_bytes))
                .layer(middleware::from_fn_with_state(
                    rate_limit.clone(),
                    rate_limit_tiles,
                )),
        )
        .route(
            "/api/tiles/{job_id}/progress",
            get(tiles::job_progress).layer(middleware::from_fn_with_state(
                rate_limit.clone(),
                rate_limit_progress,
            )),
        )
        .route(
            "/api/tiles/{job_id}/download",
            get(tiles::job_download).layer(middleware::from_fn_with_state(
                rate_limit.clone(),
                rate_limit_download,
            )),
        )
        .route(
            "/api/tiles/{job_id}/thumbnail",
            get(tiles::job_thumbnail).layer(middleware::from_fn_with_state(
                rate_limit.clone(),
                rate_limit_download,
            )),
        )
        .route(
            "/api/tiles/{job_id}/download/pmtiles",
            get(tiles::job_download_pmtiles).layer(middleware::from_fn_with_state(
                rate_limit.clone(),
                rate_limit_download,
            )),
        )
        // User
        .route("/api/user", get(user::get_current_user))
        .route(
            "/api/user/deactivate",
            post(user::deactivate_user).layer(middleware::from_fn_with_state(
                rate_limit.clone(),
                rate_limit_mutations,
            )),
        )
        .route(
            "/api/user/reactivate",
            post(user::reactivate_user).layer(middleware::from_fn_with_state(
                rate_limit.clone(),
                rate_limit_mutations,
            )),
        )
        // Accounts (linked providers)
        .route("/api/user/accounts", get(accounts::list_accounts))
        .route(
            "/api/user/accounts/{provider}",
            axum::routing::delete(accounts::unlink_account).layer(
                middleware::from_fn_with_state(rate_limit.clone(), rate_limit_mutations),
            ),
        )
        .route(
            "/api/user/avatar",
            axum::routing::put(accounts::update_avatar).layer(
                middleware::from_fn_with_state(rate_limit.clone(), rate_limit_mutations),
            ),
        )
        // Admin
        .route(
            "/api/admin/purge-deactivated",
            post(admin::purge_deactivated),
        )
        .route(
            "/api/admin/broadcast-notification",
            post(admin::broadcast_notification),
        )
        // Notifications
        .route(
            "/api/notifications",
            get(notifications::list_notifications)
                .post(notifications::create_notification)
                .delete(notifications::clear_notifications)
                .layer(middleware::from_fn_with_state(
                    rate_limit.clone(),
                    rate_limit_mutations,
                )),
        )
        .route(
            "/api/notifications/read",
            post(notifications::mark_notifications_read).layer(
                middleware::from_fn_with_state(rate_limit.clone(), rate_limit_mutations),
            ),
        )
        // API keys
        .route(
            "/api/keys",
            post(api_keys::create_api_key)
                .get(api_keys::get_api_key)
                .delete(api_keys::revoke_api_key)
                .layer(middleware::from_fn_with_state(
                    rate_limit.clone(),
                    rate_limit_mutations,
                )),
        )
        // Tilesets
        .route(
            "/api/tilesets",
            post(tilesets::create_tileset)
                .get(tilesets::list_tilesets)
                .layer(middleware::from_fn_with_state(
                    rate_limit.clone(),
                    rate_limit_mutations,
                )),
        )
        .route(
            "/api/tilesets/{slug}",
            get(tilesets::get_tileset)
                .patch(tilesets::update_tileset)
                .delete(tilesets::delete_tileset)
                .layer(middleware::from_fn_with_state(
                    rate_limit.clone(),
                    rate_limit_mutations,
                )),
        )
        .route(
            "/api/tilesets/{slug}/pmtiles-url",
            get(tilesets::tileset_pmtiles_url).layer(middleware::from_fn_with_state(
                rate_limit.clone(),
                rate_limit_download,
            )),
        )
        // Global layers
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::optional_auth,
        ))
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
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

    let redis = match config.redis_url {
        Some(ref url) => init_redis(url).await,
        None => {
            tracing::info!("REDIS_URL not set — async jobs disabled, inline processing only");
            None
        }
    };

    let db = match config.database_url {
        Some(ref url) => init_postgres(url).await,
        None => {
            tracing::info!("DATABASE_URL not set — DB features disabled");
            None
        }
    };

    let nats = match config.nats_url {
        Some(ref url) => init_nats(url).await,
        None => {
            tracing::info!("NATS_URL not set — NATS job queue disabled");
            None
        }
    };

    let bucket = tileforge_shared::s3::bucket_from_env();
    tracing::info!(
        "S3: {}",
        if bucket.is_some() { "configured" } else { "not configured" }
    );
    tracing::info!(
        "JWT: {}",
        if config.jwt_secret.is_some() {
            "configured"
        } else {
            "not configured (auth disabled)"
        }
    );

    let state = AppState {
        max_upload_bytes: config.max_upload_bytes,
        redis: redis.clone(),
        nats,
        bucket: bucket.map(Arc::from),
        db,
        jwt_secret: config.jwt_secret.clone(),
        admin_secret: config.admin_secret.clone(),
    };

    let rate_limit = RateLimit { redis };
    let app = build_router(state, rate_limit, &config);

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    /// Build a minimal app with no external services.
    /// Uses `into_make_service_with_connect_info` to provide SocketAddr for rate limiting.
    async fn test_request(req: Request<Body>) -> axum::response::Response {
        let state = AppState {
            max_upload_bytes: 10 * 1024 * 1024,
            redis: None,
            nats: None,
            bucket: None,
            db: None,
            jwt_secret: Some("test-secret".into()),
            admin_secret: Some("admin-secret".into()),
        };
        let rate_limit = RateLimit { redis: None };
        let config = config::AppConfig {
            port: 8080,
            max_upload_bytes: 10 * 1024 * 1024,
            redis_url: None,
            nats_url: None,
            cors_origin: None,
            database_url: None,
            jwt_secret: Some("test-secret".into()),
            admin_secret: Some("admin-secret".into()),
        };
        let app = build_router(state, rate_limit, &config);
        let mut svc = app.into_make_service_with_connect_info::<SocketAddr>();

        // Create a service bound to a fake peer address
        use tower::Service;
        let svc = svc
            .call("127.0.0.1:12345".parse::<SocketAddr>().unwrap())
            .await
            .unwrap();
        svc.oneshot(req).await.unwrap()
    }

    fn make_jwt(sub: &str, plan: &str, secret: &str) -> String {
        use jsonwebtoken::{encode, EncodingKey, Header};
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = serde_json::json!({
            "sub": sub,
            "plan": plan,
            "iat": now,
            "exp": now + 3600,
        });
        encode(
            &Header::new(jsonwebtoken::Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap()
    }

    fn get(uri: &str) -> Request<Body> {
        Request::builder().uri(uri).body(Body::empty()).unwrap()
    }

    fn post(uri: &str, body: Vec<u8>) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(uri)
            .body(Body::from(body))
            .unwrap()
    }

    fn get_with_auth(uri: &str, token: &str) -> Request<Body> {
        Request::builder()
            .uri(uri)
            .header("Authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap()
    }

    fn post_with_auth(uri: &str, token: &str, body: Vec<u8>) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(uri)
            .header("Authorization", format!("Bearer {token}"))
            .body(Body::from(body))
            .unwrap()
    }

    #[tokio::test]
    async fn health_returns_ok() {
        let resp = test_request(get("/health")).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&body[..], b"ok");
    }

    #[tokio::test]
    async fn tiles_empty_body_returns_400() {
        let resp = test_request(post("/api/tiles", vec![])).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn tiles_invalid_tile_size_returns_400() {
        let resp = test_request(post("/api/tiles?tile_size=64", vec![1, 2, 3])).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn tiles_invalid_projection_returns_400() {
        let resp = test_request(post("/api/tiles?projection=cylindrical", vec![1, 2, 3])).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn tiles_max_zoom_exceeded_returns_400() {
        let resp = test_request(post("/api/tiles?max_zoom=15", vec![1, 2, 3])).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn tiles_sync_with_small_png() {
        let mut img = image::RgbaImage::new(4, 4);
        for pixel in img.pixels_mut() {
            *pixel = image::Rgba([0, 128, 255, 255]);
        }
        let mut buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut buf, image::ImageFormat::Png).unwrap();

        let resp = test_request(post("/api/tiles", buf.into_inner())).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers().get("content-type").unwrap(), "application/zip");
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        assert!(!body.is_empty());
    }

    #[tokio::test]
    async fn user_endpoint_requires_auth() {
        let resp = test_request(get("/api/user")).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn user_endpoint_with_valid_jwt() {
        let token = make_jwt("550e8400-e29b-41d4-a716-446655440000", "free", "test-secret");
        let resp = test_request(get_with_auth("/api/user", &token)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["plan"], "free");
        assert_eq!(json["id"], "550e8400-e29b-41d4-a716-446655440000");
    }

    #[tokio::test]
    async fn user_endpoint_with_invalid_jwt() {
        let token = make_jwt("550e8400-e29b-41d4-a716-446655440000", "free", "wrong-secret");
        let resp = test_request(get_with_auth("/api/user", &token)).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn keys_endpoint_requires_auth() {
        let resp = test_request(get("/api/keys")).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn notifications_require_auth() {
        let resp = test_request(get("/api/notifications")).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn tilesets_without_db_returns_503() {
        let resp = test_request(get("/api/tilesets")).await;
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn swagger_ui_accessible() {
        let resp = test_request(get("/swagger-ui/")).await;
        assert!(resp.status().is_success() || resp.status().is_redirection());
    }

    #[tokio::test]
    async fn nonexistent_route_returns_404() {
        let resp = test_request(get("/api/nonexistent")).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn admin_purge_no_auth_returns_401() {
        let resp = test_request(post("/api/admin/purge-deactivated", vec![])).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn admin_purge_wrong_secret_returns_403() {
        let resp = test_request(post_with_auth(
            "/api/admin/purge-deactivated",
            "wrong-secret",
            vec![],
        ))
        .await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn pro_user_needs_async_services() {
        let token = make_jwt("550e8400-e29b-41d4-a716-446655440000", "pro", "test-secret");
        let resp = test_request(post_with_auth("/api/tiles", &token, vec![0u8; 100])).await;
        // Pro users always go async, but no Redis/S3/DB configured
        let status = resp.status();
        assert!(
            status == StatusCode::SERVICE_UNAVAILABLE
                || status == StatusCode::PAYLOAD_TOO_LARGE
                || status == StatusCode::INTERNAL_SERVER_ERROR,
            "expected 5xx or 413, got {status}"
        );
    }
}
