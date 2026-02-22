use std::sync::Arc;

use sqlx::PgPool;

use crate::error::ApiError;

/// 5 GB storage quota for Pro users.
pub const QUOTA_PRO_BYTES: i64 = 5 * 1024 * 1024 * 1024;

/// Presigned URL TTL: 10 minutes.
pub const PRESIGN_TTL_SECS: u32 = 600;

/// Stale job timeout: 5 minutes with no progress update.
pub const STALE_JOB_TIMEOUT_SECS: u64 = 300;

/// S3 object suffixes for tileset storage cleanup.
pub const TILESET_S3_OBJECTS: &[&str] = &["tiles.zip", "tiles.pmtiles", "thumbnail.jpg"];

#[derive(Clone)]
pub struct AppState {
    pub max_upload_bytes: usize,
    pub redis: Option<redis::aio::MultiplexedConnection>,
    pub nats: Option<async_nats::jetstream::Context>,
    pub bucket: Option<Arc<s3::Bucket>>,
    pub db: Option<PgPool>,
    pub jwt_secret: Option<String>,
    pub admin_secret: Option<String>,
}

pub fn require_db(state: &AppState) -> Result<PgPool, ApiError> {
    state
        .db
        .clone()
        .ok_or_else(|| ApiError::ServiceUnavailable("database not configured".into()))
}

pub fn require_bucket(state: &AppState) -> Result<&Arc<s3::Bucket>, ApiError> {
    state
        .bucket
        .as_ref()
        .ok_or_else(|| ApiError::ServiceUnavailable("S3 not configured".into()))
}

/// Delete all S3 objects for a tileset storage path.
pub async fn delete_tileset_s3_objects(bucket: &s3::Bucket, storage_path: &str) {
    for suffix in TILESET_S3_OBJECTS {
        let _ = bucket.delete_object(&format!("{storage_path}/{suffix}")).await;
    }
}
