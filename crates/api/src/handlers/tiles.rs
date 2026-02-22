use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{
        sse::{Event, KeepAlive},
        IntoResponse, Response, Sse,
    },
    Json,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::time::{SystemTime, UNIX_EPOCH};
use tileforge_core::{streaming::should_use_streaming, Projection, TileConfig, Tiler, ZipTileWriter, STREAMING_THRESHOLD};
use tileforge_shared::{
    progress_key, tile_s3_prefix, upload_s3_key, JobProgress, TileJob,
    NATS_JOBS_SUBJECT, REDIS_JOBS_KEY,
};
use uuid::Uuid;

use crate::auth::{Claims, OptionalClaims, Plan};
use crate::error::ApiError;
use crate::state::{require_bucket, AppState, QUOTA_PRO_BYTES, STALE_JOB_TIMEOUT_SECS};

const MAX_ZOOM_LIMIT: u32 = 12;

#[derive(Deserialize, utoipa::IntoParams)]
pub struct TileParams {
    tile_size: Option<u32>,
    min_zoom: Option<u32>,
    max_zoom: Option<u32>,
    projection: Option<String>,
    file_name: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct AcceptedResponse {
    job_id: String,
}

fn parse_projection(s: &str) -> Result<Projection, ApiError> {
    match s {
        "flat" => Ok(Projection::Flat),
        "mercator" => Ok(Projection::Mercator),
        "isometric" => Ok(Projection::Isometric),
        _ => Err(ApiError::InvalidField(
            "projection must be 'flat', 'mercator', or 'isometric'".into(),
        )),
    }
}

fn validate_tile_params(params: &TileParams) -> Result<(u32, Projection), ApiError> {
    let tile_size = params.tile_size.unwrap_or(256);
    if !matches!(tile_size, 128 | 256 | 512) {
        return Err(ApiError::InvalidField("tile_size must be 128, 256, or 512".into()));
    }
    if let Some(mz) = params.max_zoom {
        if mz > MAX_ZOOM_LIMIT {
            return Err(ApiError::InvalidField(
                format!("max_zoom cannot exceed {MAX_ZOOM_LIMIT}"),
            ));
        }
    }
    let projection = parse_projection(params.projection.as_deref().unwrap_or("flat"))?;
    Ok((tile_size, projection))
}

async fn reserve_storage(
    state: &AppState,
    user: &crate::auth::UserClaims,
    body_len: usize,
) -> Result<Option<i64>, ApiError> {
    let Some(ref db) = state.db else { return Ok(None) };
    let user_id = Uuid::parse_str(&user.sub).map_err(|_| ApiError::Unauthorized)?;
    let estimate = (body_len as i64) * 2;
    let reserved: Option<(bool,)> = sqlx::query_as("SELECT reserve_storage($1, $2, $3)")
        .bind(user_id)
        .bind(estimate)
        .bind(QUOTA_PRO_BYTES)
        .fetch_optional(db)
        .await
        .map_err(|e| ApiError::Db(e.to_string()))?;
    if reserved.map(|r| r.0).unwrap_or(false) {
        Ok(Some(estimate))
    } else {
        Err(ApiError::QuotaExceeded)
    }
}

async fn enqueue_async(
    state: &AppState,
    job_id: &str,
    body: &Bytes,
    params: &TileParams,
    user: Option<&crate::auth::UserClaims>,
    projection_str: &str,
    tile_size: u32,
    reserved_bytes: Option<i64>,
) -> Result<Response, ApiError> {
    let (mut redis, bucket) = match (&state.redis, &state.bucket) {
        (Some(r), Some(b)) => (r.clone(), b.clone()),
        _ => {
            return Err(ApiError::ServiceUnavailable(
                "async processing not configured (REDIS_URL and S3 env vars required)".into(),
            ));
        }
    };

    // Upload image bytes to S3
    bucket
        .put_object(&upload_s3_key(job_id), body)
        .await
        .map_err(|e| ApiError::Processing(format!("S3 upload failed: {e}")))?;

    // Set initial progress in Redis
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    let initial_progress = serde_json::json!({
        "status": "queued",
        "last_updated": now,
        "user_id": user.map(|c| &c.sub),
    });
    let _: redis::RedisResult<()> = redis
        .set_ex(progress_key(job_id), initial_progress.to_string(), 3600u64)
        .await;

    // Build job payload
    let job = TileJob {
        job_id: job_id.to_string(),
        tile_size: Some(tile_size),
        min_zoom: params.min_zoom,
        max_zoom: params.max_zoom,
        projection: Some(projection_str.to_string()),
        user_id: user.map(|c| c.sub.clone()),
        file_name: params.file_name.clone(),
        reserved_bytes,
    };
    let job_json = serde_json::to_string(&job).unwrap();

    if let Some(ref nats) = state.nats {
        nats.publish(NATS_JOBS_SUBJECT, job_json.into())
            .await
            .map_err(|e| ApiError::Processing(format!("NATS publish failed: {e}")))?
            .await
            .map_err(|e| ApiError::Processing(format!("NATS publish ack failed: {e}")))?;
        tracing::info!(job_id = %job_id, "enqueued async job via NATS");
    } else {
        let _: redis::RedisResult<()> = redis.lpush(REDIS_JOBS_KEY, &job_json).await;
        tracing::info!(job_id = %job_id, "enqueued async job via Redis (NATS not configured)");
    }

    Ok((StatusCode::ACCEPTED, Json(AcceptedResponse { job_id: job_id.to_string() })).into_response())
}

fn process_sync(body: Bytes, tile_size: u32, min_zoom: Option<u32>, max_zoom: Option<u32>, projection: Projection) -> Result<Vec<u8>, ApiError> {
    let image_bytes = body.to_vec();
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
    Ok(zip_writer.into_inner().unwrap().into_inner())
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
        (status = 400, description = "Invalid input", body = crate::error::ErrorBody),
        (status = 429, description = "Rate limit exceeded", body = crate::error::ErrorBody)
    )
)]
pub async fn process_tiles(
    State(state): State<AppState>,
    claims: OptionalClaims,
    Query(params): Query<TileParams>,
    body: Bytes,
) -> Result<Response, ApiError> {
    if body.is_empty() {
        return Err(ApiError::MissingImage);
    }
    if body.len() > state.max_upload_bytes {
        return Err(ApiError::ImageTooLarge { limit: state.max_upload_bytes });
    }

    let (tile_size, projection) = validate_tile_params(&params)?;
    let projection_str = params.projection.as_deref().unwrap_or("flat");

    let is_pro = claims.0.as_ref().is_some_and(|c| c.plan == Plan::Pro);

    if tileforge_core::is_tiff(&body) && !is_pro {
        return Err(ApiError::FormatRequiresPro("TIFF/GeoTIFF".into()));
    }

    let reserved_bytes = if is_pro {
        reserve_storage(&state, claims.0.as_ref().unwrap(), body.len()).await?
    } else {
        None
    };

    let is_large = should_use_streaming(&body, STREAMING_THRESHOLD);

    if is_pro || is_large {
        let job_id = Uuid::new_v4().to_string();
        return enqueue_async(
            &state, &job_id, &body, &params,
            claims.0.as_ref(), projection_str, tile_size, reserved_bytes,
        ).await;
    }

    // Sync path
    let min_zoom = params.min_zoom;
    let max_zoom = params.max_zoom;
    let zip_bytes = tokio::task::spawn_blocking(move || {
        process_sync(body, tile_size, min_zoom, max_zoom, projection)
    })
    .await
    .map_err(|e| ApiError::Processing(format!("task join error: {e}")))?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"tiles.zip\""),
        ],
        zip_bytes?,
    )
        .into_response())
}

// ---------------------------------------------------------------------------
// SSE progress
// ---------------------------------------------------------------------------

pub async fn job_progress(
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
        let key = progress_key(&job_id);
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(500));

        for _ in 0..1200u32 {
            interval.tick().await;
            let val: redis::RedisResult<Option<String>> = conn.get(&key).await;

            let (event, is_terminal) = match val {
                Ok(Some(json)) => {
                    let mut terminal = false;
                    if let Ok(progress) = serde_json::from_str::<JobProgress>(&json) {
                        if progress.status == "complete" || progress.status == "failed" {
                            terminal = true;
                        } else if progress.last_updated > 0 {
                            let now = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap()
                                .as_secs();
                            if now - progress.last_updated > STALE_JOB_TIMEOUT_SECS {
                                let stale = serde_json::json!({
                                    "status": "failed",
                                    "error": "job timed out (worker may have crashed)",
                                });
                                let _ = tx.send(Ok(Event::default().data(stale.to_string()))).await;
                                return;
                            }
                        }
                    }
                    (Ok(Event::default().data(json)), terminal)
                }
                Ok(None) => (
                    Ok(Event::default().data(serde_json::json!({"status": "unknown"}).to_string())),
                    false,
                ),
                Err(e) => (
                    Ok(Event::default().data(
                        serde_json::json!({"status": "error", "error": e.to_string()}).to_string(),
                    )),
                    true,
                ),
            };

            if tx.send(event).await.is_err() {
                break;
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
// Downloads
// ---------------------------------------------------------------------------

async fn verify_job_owner(
    redis: &mut redis::aio::MultiplexedConnection,
    job_id: &str,
    user: &crate::auth::UserClaims,
) -> Result<(), ApiError> {
    let key = progress_key(job_id);
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

pub async fn job_download(
    Claims(user): Claims,
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Response, ApiError> {
    if let Some(ref redis) = state.redis {
        verify_job_owner(&mut redis.clone(), &job_id, &user).await?;
    }

    let bucket = require_bucket(&state)?;
    let response = bucket
        .get_object(&format!("{}/tiles.zip", tile_s3_prefix(&job_id)))
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

pub async fn job_thumbnail(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Response, ApiError> {
    let bucket = require_bucket(&state)?;
    let resp = bucket
        .get_object(&format!("{}/thumbnail.jpg", tile_s3_prefix(&job_id)))
        .await
        .map_err(|_| ApiError::NotFound)?;

    let bytes = resp.to_vec();
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, axum::http::HeaderValue::from_static("image/jpeg")),
            (header::CACHE_CONTROL, axum::http::HeaderValue::from_static("public, max-age=86400")),
            (header::CONTENT_LENGTH, axum::http::HeaderValue::from_str(&bytes.len().to_string()).unwrap()),
        ],
        bytes,
    )
        .into_response())
}

pub async fn job_download_pmtiles(
    Claims(user): Claims,
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Response, ApiError> {
    if let Some(ref redis) = state.redis {
        verify_job_owner(&mut redis.clone(), &job_id, &user).await?;
    }

    let bucket = require_bucket(&state)?;
    let response = bucket
        .get_object(&format!("{}/tiles.pmtiles", tile_s3_prefix(&job_id)))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn params(tile_size: Option<u32>, max_zoom: Option<u32>, projection: Option<&str>) -> TileParams {
        TileParams {
            tile_size,
            min_zoom: None,
            max_zoom,
            projection: projection.map(|s| s.to_string()),
            file_name: None,
        }
    }

    // ---- validate_tile_params ----

    #[test]
    fn default_params() {
        let (size, proj) = validate_tile_params(&params(None, None, None)).unwrap();
        assert_eq!(size, 256);
        assert!(matches!(proj, Projection::Flat));
    }

    #[test]
    fn valid_tile_sizes() {
        for size in [128, 256, 512] {
            let result = validate_tile_params(&params(Some(size), None, None));
            assert!(result.is_ok(), "tile_size {size} should be valid");
        }
    }

    #[test]
    fn invalid_tile_size() {
        let result = validate_tile_params(&params(Some(64), None, None));
        assert!(result.is_err());
        let result = validate_tile_params(&params(Some(1024), None, None));
        assert!(result.is_err());
    }

    #[test]
    fn max_zoom_within_limit() {
        let result = validate_tile_params(&params(None, Some(12), None));
        assert!(result.is_ok());
    }

    #[test]
    fn max_zoom_exceeds_limit() {
        let result = validate_tile_params(&params(None, Some(13), None));
        assert!(result.is_err());
    }

    #[test]
    fn max_zoom_none_is_ok() {
        let result = validate_tile_params(&params(None, None, None));
        assert!(result.is_ok());
    }

    // ---- parse_projection ----

    #[test]
    fn valid_projections() {
        assert!(matches!(parse_projection("flat").unwrap(), Projection::Flat));
        assert!(matches!(parse_projection("mercator").unwrap(), Projection::Mercator));
        assert!(matches!(parse_projection("isometric").unwrap(), Projection::Isometric));
    }

    #[test]
    fn invalid_projection() {
        assert!(parse_projection("cylindrical").is_err());
        assert!(parse_projection("").is_err());
    }

    #[test]
    fn projection_from_params() {
        let (_, proj) = validate_tile_params(&params(None, None, Some("mercator"))).unwrap();
        assert!(matches!(proj, Projection::Mercator));
    }

    // ---- process_sync ----

    #[test]
    fn sync_processing_small_image() {
        let mut img = image::RgbaImage::new(2, 2);
        for pixel in img.pixels_mut() {
            *pixel = image::Rgba([255, 0, 0, 255]);
        }
        let mut buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut buf, image::ImageFormat::Png).unwrap();
        let bytes = Bytes::from(buf.into_inner());

        let result = process_sync(bytes, 256, None, None, Projection::Flat);
        assert!(result.is_ok());
        let zip_bytes = result.unwrap();
        assert!(!zip_bytes.is_empty());
    }
}
