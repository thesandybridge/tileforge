pub mod s3;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub const REDIS_PROGRESS_PREFIX: &str = "tileforge:progress";
pub const REDIS_JOBS_KEY: &str = "tileforge:jobs";
pub const NATS_JOBS_SUBJECT: &str = "tileforge.jobs";
pub const NATS_STREAM_NAME: &str = "TILEFORGE_JOBS";
pub const S3_UPLOADS_PREFIX: &str = "uploads";
pub const S3_TILES_PREFIX: &str = "tiles";
pub const TILESET_S3_SUFFIXES: &[&str] = &["tiles.zip", "tiles.pmtiles", "thumbnail.jpg"];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

pub fn progress_key(job_id: &str) -> String {
    format!("{REDIS_PROGRESS_PREFIX}:{job_id}")
}

pub fn upload_s3_key(job_id: &str) -> String {
    format!("{S3_UPLOADS_PREFIX}/{job_id}.bin")
}

pub fn tile_s3_prefix(job_id: &str) -> String {
    format!("{S3_TILES_PREFIX}/{job_id}")
}

// ---------------------------------------------------------------------------
// Job types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct TileJob {
    pub job_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tile_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_zoom: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_zoom: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reserved_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
}

// ---------------------------------------------------------------------------
// Progress type
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct JobProgress {
    pub status: String,
    #[serde(default)]
    pub last_updated: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tiles_done: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tiles_total: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pmtiles_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_key_format() {
        assert_eq!(progress_key("abc-123"), "tileforge:progress:abc-123");
    }

    #[test]
    fn upload_s3_key_format() {
        assert_eq!(upload_s3_key("abc-123"), "uploads/abc-123.bin");
    }

    #[test]
    fn tile_s3_prefix_format() {
        assert_eq!(tile_s3_prefix("abc-123"), "tiles/abc-123");
    }

    #[test]
    fn tile_job_roundtrip() {
        let job = TileJob {
            job_id: "test-id".into(),
            tile_size: Some(256),
            min_zoom: None,
            max_zoom: Some(5),
            projection: Some("flat".into()),
            user_id: None,
            file_name: Some("map.png".into()),
            reserved_bytes: None,
            scale: None,
            background_color: None,
        };
        let json = serde_json::to_string(&job).unwrap();
        let parsed: TileJob = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.job_id, "test-id");
        assert_eq!(parsed.tile_size, Some(256));
        assert!(parsed.user_id.is_none());
    }

    #[test]
    fn job_progress_roundtrip() {
        let progress = JobProgress {
            status: "processing".into(),
            last_updated: 1234567890,
            zoom: Some(3),
            tiles_done: Some(10),
            tiles_total: Some(100),
            download_url: None,
            pmtiles_url: None,
            error: None,
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(!json.contains("download_url")); // skip_serializing_if
        let parsed: JobProgress = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.status, "processing");
        assert_eq!(parsed.tiles_done, Some(10));
    }

    #[test]
    fn job_progress_default() {
        let p = JobProgress::default();
        assert_eq!(p.status, "");
        assert_eq!(p.last_updated, 0);
        assert!(p.zoom.is_none());
    }
}
