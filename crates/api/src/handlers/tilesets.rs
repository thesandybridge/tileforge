use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{parse_user_id, Claims, OptionalClaims, Plan};
use crate::error::ApiError;
use crate::state::{delete_tileset_s3_objects, require_bucket, require_db, AppState, PRESIGN_TTL_SECS};
use tileforge_shared::{progress_key, tile_s3_prefix};

const TILESET_COLUMNS: &str =
    "id, user_id, name, slug, projection, tile_size, min_zoom, max_zoom, \
     tile_count, size_bytes, storage_path, public, created_at, width, height";

#[derive(Serialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct TileSetRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub slug: String,
    pub projection: String,
    pub tile_size: i32,
    pub min_zoom: i32,
    pub max_zoom: i32,
    pub tile_count: i32,
    pub size_bytes: i64,
    pub storage_path: String,
    pub public: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

#[derive(Deserialize)]
pub struct CreateTileSet {
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
pub struct UpdateTileSet {
    name: Option<String>,
    public: Option<bool>,
}

#[derive(Deserialize, utoipa::IntoParams)]
pub struct ListTileSetsQuery {
    user_id: Option<Uuid>,
    page: Option<i64>,
    per_page: Option<i64>,
    search: Option<String>,
}

fn pagination(page: Option<i64>, per_page: Option<i64>) -> (i64, i64) {
    let per_page = per_page.unwrap_or(50).clamp(1, 100);
    let page = page.unwrap_or(1).max(1);
    (per_page, (page - 1) * per_page)
}

/// Check if the caller owns a tileset. Returns false for unauthenticated users.
fn is_owner(claims: &OptionalClaims, owner_id: Uuid) -> bool {
    claims
        .0
        .as_ref()
        .and_then(|c| Uuid::parse_str(&c.sub).ok())
        .map(|uid| uid == owner_id)
        .unwrap_or(false)
}

fn validate_create(body: &CreateTileSet) -> Result<Uuid, ApiError> {
    if body.name.trim().is_empty() || body.name.len() > 200 {
        return Err(ApiError::InvalidField("name must be 1-200 characters".into()));
    }
    if body.slug.is_empty()
        || body.slug.len() > 100
        || !body.slug.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(ApiError::InvalidField(
            "slug must be 1-100 letters, numbers, dots, dashes, or underscores".into(),
        ));
    }
    if !matches!(body.projection.as_deref().unwrap_or("flat"), "flat" | "mercator" | "isometric") {
        return Err(ApiError::InvalidField("invalid projection".into()));
    }
    if !matches!(body.tile_size.unwrap_or(256), 128 | 256 | 512) {
        return Err(ApiError::InvalidField("tile_size must be 128, 256, or 512".into()));
    }
    let min_zoom = body.min_zoom.unwrap_or(0);
    if min_zoom < 0 || body.max_zoom < min_zoom || body.max_zoom > 12 {
        return Err(ApiError::InvalidField("zoom range must be between 0 and 12".into()));
    }
    if body.tile_count <= 0 || body.size_bytes <= 0 {
        return Err(ApiError::InvalidField("tile_count and size_bytes must be positive".into()));
    }

    let job_id = body
        .storage_path
        .strip_prefix("tiles/")
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| ApiError::InvalidField("storage_path must be tiles/{job_id}".into()))?;
    if body.storage_path != tile_s3_prefix(&job_id.to_string()) {
        return Err(ApiError::InvalidField("storage_path is not canonical".into()));
    }
    Ok(job_id)
}

async fn verify_completed_job(
    state: &AppState,
    job_id: Uuid,
    user_id: Uuid,
) -> Result<(), ApiError> {
    let mut redis = state
        .redis
        .clone()
        .ok_or_else(|| ApiError::ServiceUnavailable("job verification unavailable".into()))?;
    let json: Option<String> = redis
        .get(progress_key(&job_id.to_string()))
        .await
        .map_err(|_| ApiError::ServiceUnavailable("job verification unavailable".into()))?;
    let value: serde_json::Value = serde_json::from_str(json.as_deref().ok_or(ApiError::NotFound)?)
        .map_err(|_| ApiError::NotFound)?;
    let owner = value.get("user_id").and_then(|value| value.as_str());
    let status = value.get("status").and_then(|value| value.as_str());
    let expected_owner = user_id.to_string();
    if owner != Some(expected_owner.as_str()) || status != Some("complete") {
        return Err(ApiError::NotFound);
    }
    Ok(())
}

pub async fn create_tileset(
    State(state): State<AppState>,
    Claims(user): Claims,
    Json(body): Json<CreateTileSet>,
) -> Result<Response, ApiError> {
    if user.plan != Plan::Pro {
        return Err(ApiError::Forbidden);
    }
    let job_id = validate_create(&body)?;

    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    // The worker normally creates this row. Preserve the existing endpoint for
    // API consumers by treating a matching owned row as metadata finalization.
    let existing = sqlx::query_as::<_, TileSetRow>(&format!(
        "SELECT {TILESET_COLUMNS} FROM tile_sets WHERE storage_path = $1"
    ))
    .bind(&body.storage_path)
    .fetch_optional(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;
    if let Some(existing) = existing {
        if existing.user_id != user_id {
            return Err(ApiError::NotFound);
        }
        let row = sqlx::query_as::<_, TileSetRow>(&format!(
            "UPDATE tile_sets SET name = $1, slug = $2, public = $3
             WHERE id = $4 RETURNING {TILESET_COLUMNS}"
        ))
        .bind(body.name.trim())
        .bind(&body.slug)
        .bind(body.public.unwrap_or(false))
        .bind(existing.id)
        .fetch_one(&db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;
        return Ok((StatusCode::CREATED, Json(row)).into_response());
    }

    verify_completed_job(&state, job_id, user_id).await?;

    // Use the actual stored object sizes for quota accounting rather than the
    // caller's declared size. Other fields remain for API compatibility.
    let bucket = require_bucket(&state)?;
    let mut actual_size = 0i64;
    for suffix in ["tiles.zip", "tiles.pmtiles"] {
        let (head, status) = bucket
            .head_object(format!("{}/{suffix}", body.storage_path))
            .await
            .map_err(|_| ApiError::NotFound)?;
        if !(200..300).contains(&status) {
            return Err(ApiError::NotFound);
        }
        actual_size += head.content_length.ok_or(ApiError::NotFound)?;
    }

    let row = sqlx::query_as::<_, TileSetRow>(&format!(
        "INSERT INTO tile_sets (user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING {TILESET_COLUMNS}",
    ))
    .bind(user_id)
    .bind(body.name.trim())
    .bind(&body.slug)
    .bind(body.projection.as_deref().unwrap_or("flat"))
    .bind(body.tile_size.unwrap_or(256))
    .bind(body.min_zoom.unwrap_or(0))
    .bind(body.max_zoom)
    .bind(body.tile_count)
    .bind(actual_size)
    .bind(&body.storage_path)
    .bind(body.public.unwrap_or(false))
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
pub async fn list_tilesets(
    State(state): State<AppState>,
    claims: OptionalClaims,
    Query(params): Query<ListTileSetsQuery>,
) -> Result<Json<Vec<TileSetRow>>, ApiError> {
    let db = require_db(&state)?;

    let caller_id = claims.0.as_ref().and_then(|c| Uuid::parse_str(&c.sub).ok());
    let target_user_id = params.user_id.or(caller_id);
    let (limit, offset) = pagination(params.page, params.per_page);

    let search_pattern = params.search.as_ref().map(|s| {
        let escaped = s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        format!("%{escaped}%")
    });

    let show_private = target_user_id
        .map(|uid| caller_id.map(|c| c == uid).unwrap_or(false))
        .unwrap_or(false);

    let rows = sqlx::query_as::<_, TileSetRow>(&format!(
        "SELECT {TILESET_COLUMNS}
         FROM tile_sets
         WHERE ($1::uuid IS NULL OR user_id = $1)
           AND ($2 OR public = true)
           AND ($3::text IS NULL OR name ILIKE $3)
         ORDER BY created_at DESC
         LIMIT $4 OFFSET $5"
    ))
    .bind(target_user_id)
    .bind(show_private)
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
        (status = 404, description = "Tileset not found", body = crate::error::ErrorBody)
    )
)]
pub async fn get_tileset(
    State(state): State<AppState>,
    claims: OptionalClaims,
    Path(slug): Path<String>,
) -> Result<Json<TileSetRow>, ApiError> {
    let db = require_db(&state)?;

    let row = sqlx::query_as::<_, TileSetRow>(&format!(
        "SELECT {TILESET_COLUMNS} FROM tile_sets WHERE slug = $1"
    ))
    .bind(&slug)
    .fetch_optional(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?
    .ok_or(ApiError::NotFound)?;

    if !row.public && !is_owner(&claims, row.user_id) {
        return Err(ApiError::NotFound);
    }

    Ok(Json(row))
}

pub async fn update_tileset(
    State(state): State<AppState>,
    Claims(user): Claims,
    Path(slug): Path<String>,
    Json(body): Json<UpdateTileSet>,
) -> Result<Json<TileSetRow>, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    let row = sqlx::query_as::<_, TileSetRow>(&format!(
        "UPDATE tile_sets
         SET name = COALESCE($1, name), public = COALESCE($2, public)
         WHERE slug = $3 AND user_id = $4
         RETURNING {TILESET_COLUMNS}"
    ))
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

pub async fn delete_tileset(
    State(state): State<AppState>,
    Claims(user): Claims,
    Path(slug): Path<String>,
) -> Result<StatusCode, ApiError> {
    let db = require_db(&state)?;
    let user_id = parse_user_id(&user)?;

    let row = sqlx::query_as::<_, TileSetRow>(&format!(
        "SELECT {TILESET_COLUMNS} FROM tile_sets WHERE slug = $1 AND user_id = $2"
    ))
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

    let remaining_references: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM tile_sets WHERE storage_path = $1",
    )
    .bind(&row.storage_path)
    .fetch_one(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?;

    if remaining_references.0 == 0 {
        if let Some(ref bucket) = state.bucket {
            delete_tileset_s3_objects(bucket, &row.storage_path).await;
            tracing::info!(slug = %slug, "deleted S3 objects for tileset");
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn tileset_pmtiles_url(
    State(state): State<AppState>,
    claims: OptionalClaims,
    Path(slug): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = require_db(&state)?;
    let bucket = require_bucket(&state)?;

    let row = sqlx::query_as::<_, TileSetRow>(&format!(
        "SELECT {TILESET_COLUMNS} FROM tile_sets WHERE slug = $1"
    ))
    .bind(&slug)
    .fetch_optional(&db)
    .await
    .map_err(|e| ApiError::Db(e.to_string()))?
    .ok_or(ApiError::NotFound)?;

    if !row.public && !is_owner(&claims, row.user_id) {
        return Err(ApiError::NotFound);
    }

    let url = bucket
        .presign_get(&format!("{}/tiles.pmtiles", row.storage_path), PRESIGN_TTL_SECS, None)
        .await
        .map_err(|_| ApiError::NotFound)?;

    Ok(Json(serde_json::json!({ "url": url })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_create() -> CreateTileSet {
        CreateTileSet {
            name: "World map".into(),
            slug: "world-map".into(),
            projection: Some("flat".into()),
            tile_size: Some(256),
            min_zoom: Some(0),
            max_zoom: 4,
            tile_count: 341,
            size_bytes: 1024,
            storage_path: "tiles/550e8400-e29b-41d4-a716-446655440000".into(),
            public: Some(false),
        }
    }

    #[test]
    fn validates_completed_job_storage_path_shape() {
        assert!(validate_create(&valid_create()).is_ok());
        let mut body = valid_create();
        body.storage_path = "tiles/../another-user".into();
        assert!(validate_create(&body).is_err());
    }

    #[test]
    fn validates_server_metadata_bounds() {
        let mut body = valid_create();
        body.size_bytes = -1;
        assert!(validate_create(&body).is_err());
        body = valid_create();
        body.max_zoom = 13;
        assert!(validate_create(&body).is_err());
        body = valid_create();
        body.projection = Some("unknown".into());
        assert!(validate_create(&body).is_err());
    }

    // ---- pagination ----

    #[test]
    fn pagination_defaults() {
        let (per_page, offset) = pagination(None, None);
        assert_eq!(per_page, 50);
        assert_eq!(offset, 0);
    }

    #[test]
    fn pagination_page_1() {
        let (per_page, offset) = pagination(Some(1), Some(20));
        assert_eq!(per_page, 20);
        assert_eq!(offset, 0);
    }

    #[test]
    fn pagination_page_3() {
        let (per_page, offset) = pagination(Some(3), Some(10));
        assert_eq!(per_page, 10);
        assert_eq!(offset, 20);
    }

    #[test]
    fn pagination_clamps_per_page() {
        let (per_page, _) = pagination(None, Some(200));
        assert_eq!(per_page, 100);

        let (per_page, _) = pagination(None, Some(0));
        assert_eq!(per_page, 1);

        let (per_page, _) = pagination(None, Some(-5));
        assert_eq!(per_page, 1);
    }

    #[test]
    fn pagination_zero_page_becomes_1() {
        let (_, offset) = pagination(Some(0), Some(10));
        assert_eq!(offset, 0);
    }

    #[test]
    fn pagination_negative_page_becomes_1() {
        let (_, offset) = pagination(Some(-3), Some(10));
        assert_eq!(offset, 0);
    }

    // ---- is_owner ----

    #[test]
    fn owner_with_matching_id() {
        let owner_id = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        let claims = OptionalClaims(Some(crate::auth::UserClaims {
            sub: "550e8400-e29b-41d4-a716-446655440000".into(),
            plan: crate::auth::Plan::Free,
            iat: None,
            exp: None,
        }));
        assert!(is_owner(&claims, owner_id));
    }

    #[test]
    fn not_owner_with_different_id() {
        let owner_id = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        let claims = OptionalClaims(Some(crate::auth::UserClaims {
            sub: "00000000-0000-0000-0000-000000000001".into(),
            plan: crate::auth::Plan::Free,
            iat: None,
            exp: None,
        }));
        assert!(!is_owner(&claims, owner_id));
    }

    #[test]
    fn not_owner_when_unauthenticated() {
        let owner_id = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        let claims = OptionalClaims(None);
        assert!(!is_owner(&claims, owner_id));
    }
}
