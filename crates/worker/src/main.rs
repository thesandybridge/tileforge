mod s3;

use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tileforge_core::{PmTilesTileWriter, Projection, TileConfig, TileProgress, Tiler, ZipTileWriter};

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

// ---------------------------------------------------------------------------
// Job / progress types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct Job {
    job_id: String,
    tile_size: Option<u32>,
    min_zoom: Option<u32>,
    max_zoom: Option<u32>,
    projection: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ProgressUpdate {
    status: String,
    last_updated: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    zoom: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tiles_done: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tiles_total: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pmtiles_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

struct WorkerConfig {
    redis_url: String,
}

impl WorkerConfig {
    fn from_env() -> Self {
        Self {
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
        }
    }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tileforge_worker=info".into()),
        )
        .init();

    let config = WorkerConfig::from_env();
    let bucket = s3::bucket_from_env().expect("S3 env vars required (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY)");

    tracing::info!("worker starting, redis={}", config.redis_url);

    let client = redis::Client::open(config.redis_url.as_str())
        .expect("invalid REDIS_URL");
    let mut conn = client
        .get_multiplexed_async_connection()
        .await
        .expect("failed to connect to Redis");

    tracing::info!("listening for jobs on tileforge:jobs");

    loop {
        // BRPOP blocks until a job is available (0 = infinite timeout)
        let result: redis::RedisResult<(String, String)> =
            redis::cmd("BRPOP")
                .arg("tileforge:jobs")
                .arg(0)
                .query_async(&mut conn)
                .await;

        let job_json = match result {
            Ok((_key, val)) => val,
            Err(e) => {
                tracing::error!("BRPOP error: {e}");
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            }
        };

        let job: Job = match serde_json::from_str(&job_json) {
            Ok(j) => j,
            Err(e) => {
                tracing::error!("invalid job JSON: {e}");
                continue;
            }
        };

        tracing::info!(job_id = %job.job_id, "processing job");

        if let Err(e) = process_job(&job, &bucket, &mut conn).await {
            tracing::error!(job_id = %job.job_id, "job failed: {e}");
            let progress = ProgressUpdate {
                status: "failed".into(),
                last_updated: unix_now(),
                zoom: None,
                tiles_done: None,
                tiles_total: None,
                download_url: None,
                pmtiles_url: None,
                error: Some(e.to_string()),
            };
            let _: redis::RedisResult<()> = conn
                .set_ex(
                    format!("tileforge:progress:{}", job.job_id),
                    serde_json::to_string(&progress).unwrap(),
                    3600,
                )
                .await;
        }
    }
}

// ---------------------------------------------------------------------------
// Process a single job
// ---------------------------------------------------------------------------

async fn process_job(
    job: &Job,
    bucket: &s3::Bucket,
    conn: &mut redis::aio::MultiplexedConnection,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let progress_key = format!("tileforge:progress:{}", job.job_id);

    // Set initial processing status
    let initial = ProgressUpdate {
        status: "processing".into(),
        last_updated: unix_now(),
        zoom: None,
        tiles_done: Some(0),
        tiles_total: Some(0),
        download_url: None,
        pmtiles_url: None,
        error: None,
    };
    conn.set_ex::<_, _, ()>(&progress_key, serde_json::to_string(&initial)?, 3600u64)
        .await?;

    // Download image from S3
    let s3_key = format!("uploads/{}.bin", job.job_id);
    let resp = bucket
        .get_object(&s3_key)
        .await
        .map_err(|e| format!("S3 download failed: {e}"))?;
    let image_bytes = resp.to_vec();

    let tile_size = job.tile_size.unwrap_or(256);
    let projection = match job.projection.as_deref() {
        Some("mercator") => Projection::Mercator,
        _ => Projection::Flat,
    };

    let config = TileConfig {
        tile_size,
        min_zoom: job.min_zoom,
        max_zoom: job.max_zoom,
        projection,
    };

    // Shared progress state: the blocking task writes here, a poller reads + publishes to Redis
    let shared_progress: Arc<Mutex<Option<TileProgress>>> = Arc::new(Mutex::new(None));
    let shared_done = Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Spawn a tokio task to poll shared_progress and write to Redis every 250ms
    let poller_conn = conn.clone();
    let poller_key = progress_key.clone();
    let poller_progress = Arc::clone(&shared_progress);
    let poller_done = Arc::clone(&shared_done);
    let poller = tokio::spawn(async move {
        let mut conn = poller_conn;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;

            // Extract under the lock, then drop guard before awaiting
            let snapshot = { poller_progress.lock().unwrap().clone() };
            if let Some(p) = snapshot {
                let update = ProgressUpdate {
                    status: "processing".into(),
                    last_updated: unix_now(),
                    zoom: Some(p.zoom),
                    tiles_done: Some(p.tiles_done),
                    tiles_total: Some(p.tiles_total),
                    download_url: None,
                    pmtiles_url: None,
                    error: None,
                };
                let _: redis::RedisResult<()> = conn
                    .set_ex(
                        &poller_key,
                        serde_json::to_string(&update).unwrap(),
                        3600u64,
                    )
                    .await;
            }

            if poller_done.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
        }
    });

    // Clone image bytes for the PMTiles pass
    let image_bytes_for_pmtiles = image_bytes.clone();
    let pmtiles_config = config.clone();

    // Run the CPU-heavy tiling in a blocking thread (ZIP pass)
    let progress_writer = Arc::clone(&shared_progress);
    let zip_bytes = tokio::task::spawn_blocking(move || {
        let tiler = Tiler::new(config);
        let buf = Cursor::new(Vec::new());
        let mut zip_writer = ZipTileWriter::new(buf);
        let last_write = Cell::new(Instant::now());
        tiler.process_bytes(&image_bytes, &mut zip_writer, |p: TileProgress| {
            let now = Instant::now();
            // Throttle updates: first tile, every 250ms, or last tile
            if p.tiles_done == 1
                || p.tiles_done == p.tiles_total
                || now.duration_since(last_write.get()).as_millis() >= 250
            {
                *progress_writer.lock().unwrap() = Some(p);
                last_write.set(now);
            }
        })?;
        Ok::<_, tileforge_core::TilerError>(zip_writer.into_inner().unwrap().into_inner())
    })
    .await??;

    // Signal poller to stop
    shared_done.store(true, std::sync::atomic::Ordering::Relaxed);
    poller.abort();
    let _ = poller.await;

    // Upload ZIP to S3
    bucket
        .put_object(&format!("tiles/{}/tiles.zip", job.job_id), &zip_bytes)
        .await
        .map_err(|e| format!("S3 ZIP upload failed: {e}"))?;

    tracing::info!(
        job_id = %job.job_id,
        zip_size = zip_bytes.len(),
        "ZIP uploaded to S3"
    );

    // Set generating_pmtiles status so clients know what's happening
    let pmtiles_status = ProgressUpdate {
        status: "generating_pmtiles".into(),
        last_updated: unix_now(),
        zoom: None,
        tiles_done: None,
        tiles_total: None,
        download_url: None,
        pmtiles_url: None,
        error: None,
    };
    conn.set_ex::<_, _, ()>(
        &progress_key,
        serde_json::to_string(&pmtiles_status)?,
        3600u64,
    )
    .await?;

    // PMTiles pass
    // TODO(perf): TeeWriter to avoid double processing
    let min_zoom = pmtiles_config.min_zoom.unwrap_or(0);
    let max_zoom = pmtiles_config.max_zoom.unwrap_or(5);
    let pmtiles_bytes = tokio::task::spawn_blocking(move || {
        let tiler = Tiler::new(pmtiles_config);
        let tmp = tempfile::NamedTempFile::new()?;
        let file = tmp.reopen()?;
        let mut writer = PmTilesTileWriter::new(file, min_zoom as u8, max_zoom as u8)?;
        tiler.process_bytes(&image_bytes_for_pmtiles, &mut writer, |_| {})?;
        std::fs::read(tmp.path()).map_err(tileforge_core::TilerError::Io)
    })
    .await??;

    bucket
        .put_object(
            &format!("tiles/{}/tiles.pmtiles", job.job_id),
            &pmtiles_bytes,
        )
        .await
        .map_err(|e| format!("S3 PMTiles upload failed: {e}"))?;

    tracing::info!(
        job_id = %job.job_id,
        pmtiles_size = pmtiles_bytes.len(),
        "PMTiles uploaded to S3"
    );

    // Set final progress
    let final_progress = ProgressUpdate {
        status: "complete".into(),
        last_updated: unix_now(),
        zoom: None,
        tiles_done: None,
        tiles_total: None,
        download_url: Some(format!("/api/tiles/{}/download", job.job_id)),
        pmtiles_url: Some(format!("/api/tiles/{}/download/pmtiles", job.job_id)),
        error: None,
    };
    conn.set_ex::<_, _, ()>(&progress_key, serde_json::to_string(&final_progress)?, 3600u64)
        .await?;

    // Cleanup: delete upload from S3
    bucket
        .delete_object(&format!("uploads/{}.bin", job.job_id))
        .await
        .ok();

    tracing::info!(job_id = %job.job_id, "job complete");

    Ok(())
}
