pub mod accounts;
pub mod admin;
pub mod api_keys;
pub mod notifications;
pub mod tiles;
pub mod tilesets;
pub mod user;

#[utoipa::path(
    get,
    path = "/health",
    tag = "Health",
    responses(
        (status = 200, description = "Service is healthy", body = String)
    )
)]
pub async fn health() -> &'static str {
    "ok"
}
