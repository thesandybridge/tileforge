use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::PathBuf;
use std::cell::Cell;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tileforge_core::{Projection, TileConfig, TileProgress, Tiler};

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
    error: Option<String>,
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

struct WorkerConfig {
    redis_url: String,
    storage_path: PathBuf,
}

impl WorkerConfig {
    fn from_env() -> Self {
        Self {
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
            storage_path: PathBuf::from(
                std::env::var("STORAGE_PATH").unwrap_or_else(|_| "/tmp/tileforge".into()),
            ),
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
    tracing::info!(
        "worker starting, redis={}, storage={}",
        config.redis_url,
        config.storage_path.display()
    );

    let client = redis::Client::open(config.redis_url.as_str())
        .expect("invalid REDIS_URL");
    let mut conn = client
        .get_multiplexed_async_connection()
        .await
        .expect("failed to connect to Redis");

    // Ensure storage directories exist
    let uploads_dir = config.storage_path.join("uploads");
    let tiles_dir = config.storage_path.join("tiles");
    tokio::fs::create_dir_all(&uploads_dir).await.ok();
    tokio::fs::create_dir_all(&tiles_dir).await.ok();

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

        if let Err(e) = process_job(&job, &config.storage_path, &mut conn).await {
            tracing::error!(job_id = %job.job_id, "job failed: {e}");
            let progress = ProgressUpdate {
                status: "failed".into(),
                last_updated: unix_now(),
                zoom: None,
                tiles_done: None,
                tiles_total: None,
                download_url: None,
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
    storage_path: &PathBuf,
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
        error: None,
    };
    conn.set_ex::<_, _, ()>(&progress_key, serde_json::to_string(&initial)?, 3600u64)
        .await?;

    // Read image from uploads
    let input_path = storage_path.join("uploads").join(format!("{}.bin", job.job_id));
    let image_bytes = tokio::fs::read(&input_path).await?;

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

    // Run the CPU-heavy tiling in a blocking thread
    let progress_writer = Arc::clone(&shared_progress);
    let zip_bytes = tokio::task::spawn_blocking(move || {
        let tiler = Tiler::new(config);
        let mut buf = Cursor::new(Vec::new());
        let last_write = Cell::new(Instant::now());
        tiler.process_bytes(&image_bytes, &mut buf, |p: TileProgress| {
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
        Ok::<_, tileforge_core::TilerError>(buf.into_inner())
    })
    .await??;

    // Signal poller to stop
    shared_done.store(true, std::sync::atomic::Ordering::Relaxed);
    poller.abort();
    let _ = poller.await;

    // Write ZIP to output directory
    let output_dir = storage_path.join("tiles").join(&job.job_id);
    tokio::fs::create_dir_all(&output_dir).await?;
    let output_path = output_dir.join("tiles.zip");
    tokio::fs::write(&output_path, &zip_bytes).await?;

    // Set final progress
    let final_progress = ProgressUpdate {
        status: "complete".into(),
        last_updated: unix_now(),
        zoom: None,
        tiles_done: None,
        tiles_total: None,
        download_url: Some(format!("/api/tiles/{}/download", job.job_id)),
        error: None,
    };
    conn.set_ex::<_, _, ()>(&progress_key, serde_json::to_string(&final_progress)?, 3600u64)
        .await?;

    // Cleanup: delete uploaded image
    if let Err(e) = tokio::fs::remove_file(&input_path).await {
        tracing::warn!(job_id = %job.job_id, "failed to delete upload: {e}");
    }

    tracing::info!(
        job_id = %job.job_id,
        zip_size = zip_bytes.len(),
        "job complete"
    );

    Ok(())
}
