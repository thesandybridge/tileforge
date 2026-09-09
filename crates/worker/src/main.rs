use async_nats::jetstream::consumer::PullConsumer;
use async_nats::jetstream::message::AckKind;
use futures::StreamExt;
use redis::AsyncCommands;
use sqlx::PgPool;
use tileforge_shared::{
    progress_key, tile_s3_prefix, upload_s3_key, JobProgress, TileJob,
    NATS_JOBS_SUBJECT, NATS_STREAM_NAME, REDIS_JOBS_KEY,
};
use uuid::Uuid;
use std::cell::Cell;
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tileforge_core::{
    streaming::should_use_streaming, BackgroundColor, PmTilesTileWriter, Projection, TeeTileWriter,
    TileConfig, TileFormat, TileProgress, Tiler, ZipTileWriter, STREAMING_THRESHOLD,
};

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

struct PersistentJobUpdate<'a> {
    status: &'a str,
    progress: i32,
    tiles_done: Option<i64>,
    tiles_total: Option<i64>,
    error: Option<&'a str>,
    retry_count: Option<i32>,
}

async fn update_persistent_job(db: Option<&PgPool>, job_id: &str, update: PersistentJobUpdate<'_>) {
    let (Some(pool), Ok(id)) = (db, Uuid::parse_str(job_id)) else { return; };
    if let Err(error) = sqlx::query(
        "UPDATE jobs SET status = $2, progress = $3, tiles_done = COALESCE($4, tiles_done),
         tiles_total = COALESCE($5, tiles_total), error = $6,
         retry_count = COALESCE($7, retry_count), updated_at = now(),
         completed_at = CASE WHEN $2 = 'complete' THEN now() ELSE completed_at END
         WHERE id = $1 AND status IN ('queued', 'processing')",
    )
    .bind(id).bind(update.status).bind(update.progress.clamp(0, 100))
    .bind(update.tiles_done).bind(update.tiles_total).bind(update.error)
    .bind(update.retry_count).execute(pool).await {
        tracing::warn!(job_id, "failed to persist job status: {error}");
    }
}

async fn job_should_stop(db: Option<&PgPool>, job_id: &str) -> bool {
    let (Some(pool), Ok(id)) = (db, Uuid::parse_str(job_id)) else { return false; };
    sqlx::query_scalar::<_, String>("SELECT status FROM jobs WHERE id = $1")
        .bind(id).fetch_optional(pool).await.ok().flatten()
        .is_some_and(|status| !matches!(status.as_str(), "queued" | "processing"))
}

async fn release_job_reservation(db: Option<&PgPool>, job_id: &str) {
    let (Some(pool), Ok(id)) = (db, Uuid::parse_str(job_id)) else { return; };
    if let Err(error) = sqlx::query("SELECT release_job_storage_reservation($1)")
        .bind(id).execute(pool).await {
        tracing::warn!(job_id, "failed to release job storage reservation: {error}");
    }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

struct WorkerConfig {
    redis_url: String,
    nats_url: Option<String>,
    database_url: Option<String>,
}

impl WorkerConfig {
    fn from_env() -> Self {
        Self {
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6380".into()),
            nats_url: std::env::var("NATS_URL").ok(),
            database_url: std::env::var("DATABASE_URL").ok(),
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
    let bucket = tileforge_shared::s3::bucket_from_env().expect("S3 env vars required (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY)");

    // Connect to Postgres if configured (for tile_set row inserts)
    let db = if let Some(ref url) = config.database_url {
        match sqlx::postgres::PgPoolOptions::new()
            .max_connections(3)
            .connect(url)
            .await
        {
            Ok(pool) => {
                tracing::info!("connected to Postgres");
                Some(pool)
            }
            Err(e) => {
                tracing::warn!("failed to connect to Postgres: {e} — tile_set inserts disabled");
                None
            }
        }
    } else {
        tracing::info!("DATABASE_URL not set — tile_set inserts disabled");
        None
    };

    // Connect to Redis (for progress tracking, and job queue fallback)
    tracing::info!(
        "worker starting, redis={}, nats={}",
        config.redis_url,
        config.nats_url.as_deref().unwrap_or("(disabled)"),
    );

    let redis_client = redis::Client::open(config.redis_url.as_str())
        .expect("invalid REDIS_URL");
    let mut conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .expect("failed to connect to Redis");

    if let Some(ref nats_url) = config.nats_url {
        run_nats_loop(nats_url, &bucket, &mut conn, db.as_ref()).await;
    } else {
        tracing::info!("NATS_URL not set — using Redis BRPOP fallback");
        run_redis_loop(&bucket, &mut conn, db.as_ref()).await;
    }
}

// ---------------------------------------------------------------------------
// NATS JetStream consumer loop
// ---------------------------------------------------------------------------

async fn run_nats_loop(
    nats_url: &str,
    bucket: &tileforge_shared::s3::Bucket,
    conn: &mut redis::aio::MultiplexedConnection,
    db: Option<&PgPool>,
) {
    let nats_client = async_nats::connect(nats_url)
        .await
        .expect("failed to connect to NATS");
    let js = async_nats::jetstream::new(nats_client);

    let stream = js
        .get_or_create_stream(async_nats::jetstream::stream::Config {
            name: NATS_STREAM_NAME.into(),
            subjects: vec![NATS_JOBS_SUBJECT.into()],
            retention: async_nats::jetstream::stream::RetentionPolicy::WorkQueue,
            max_age: Duration::from_secs(86400),
            storage: async_nats::jetstream::stream::StorageType::File,
            ..Default::default()
        })
        .await
        .expect("failed to get TILEFORGE_JOBS stream");

    let consumer: PullConsumer = stream
        .get_or_create_consumer(
            "tileforge-worker",
            async_nats::jetstream::consumer::pull::Config {
                durable_name: Some("tileforge-worker".into()),
                ack_wait: Duration::from_secs(600),
                max_deliver: 5,
                backoff: vec![
                    Duration::from_secs(30),
                    Duration::from_secs(120),
                    Duration::from_secs(300),
                    Duration::from_secs(600),
                ],
                ..Default::default()
            },
        )
        .await
        .expect("failed to create pull consumer");

    tracing::info!("listening for jobs on NATS JetStream (TILEFORGE_JOBS)");

    let mut messages = consumer.messages().await.expect("failed to start message stream");

    while let Some(msg_result) = messages.next().await {
        let msg = match msg_result {
            Ok(m) => m,
            Err(e) => {
                tracing::error!("message receive error: {e}");
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };

        let job: TileJob = match serde_json::from_slice(&msg.payload) {
            Ok(j) => j,
            Err(e) => {
                tracing::error!("invalid job JSON: {e}");
                let _ = msg.ack_with(AckKind::Term).await;
                continue;
            }
        };

        let delivery_count = msg.info().map(|i| i.delivered).unwrap_or(1);
        tracing::info!(job_id = %job.job_id, delivery = delivery_count, "processing job");

        if job_should_stop(db, &job.job_id).await {
            let _ = msg.ack().await;
            bucket.delete_object(&upload_s3_key(&job.job_id)).await.ok();
            release_job_reservation(db, &job.job_id).await;
            continue;
        }

        let result = process_job(&job, bucket, conn, db).await;

        match result {
            Ok(()) => {
                if let Err(e) = msg.ack().await {
                    tracing::error!(job_id = %job.job_id, "failed to ack message: {e}");
                }
                bucket
                    .delete_object(&upload_s3_key(&job.job_id))
                    .await
                    .ok();
                tracing::info!(job_id = %job.job_id, "job complete, acked");
            }
            Err(e) => {
                tracing::error!(job_id = %job.job_id, delivery = delivery_count, "job failed: {e}");
                let progress = JobProgress {
                    status: "failed".into(),
                    last_updated: unix_now(),
                    user_id: job.user_id.clone(),
                    error: Some(e.to_string()),
                    ..Default::default()
                };
                let _: redis::RedisResult<()> = conn
                    .set_ex(
                        progress_key(&job.job_id),
                        serde_json::to_string(&progress).unwrap(),
                        3600,
                    )
                    .await;

                let error = e.to_string();
                update_persistent_job(db, &job.job_id, PersistentJobUpdate {
                    status: if delivery_count >= 5 { "failed" } else { "queued" },
                    progress: 0,
                    tiles_done: None,
                    tiles_total: None,
                    error: Some(&error),
                    retry_count: Some(delivery_count as i32),
                }).await;

                if delivery_count >= 5 {
                    tracing::warn!(job_id = %job.job_id, "max retries reached, terminating");
                    let _ = msg.ack_with(AckKind::Term).await;
                    // Release storage reservation on permanent failure
                    release_job_reservation(db, &job.job_id).await;
                } else {
                    let delay = match delivery_count {
                        1 => Duration::from_secs(30),
                        2 => Duration::from_secs(120),
                        3 => Duration::from_secs(300),
                        _ => Duration::from_secs(600),
                    };
                    let _ = msg.ack_with(AckKind::Nak(Some(delay))).await;
                }
            }
        }
    }

    tracing::warn!("NATS message stream ended, shutting down");
}

// ---------------------------------------------------------------------------
// Redis BRPOP fallback loop (when NATS_URL is not set)
// ---------------------------------------------------------------------------

async fn run_redis_loop(
    bucket: &tileforge_shared::s3::Bucket,
    conn: &mut redis::aio::MultiplexedConnection,
    db: Option<&PgPool>,
) {
    tracing::info!("listening for jobs on Redis ({REDIS_JOBS_KEY})");

    loop {
        let result: redis::RedisResult<(String, String)> =
            redis::cmd("BRPOP")
                .arg(REDIS_JOBS_KEY)
                .arg(0)
                .query_async(conn)
                .await;

        let job_json = match result {
            Ok((_key, val)) => val,
            Err(e) => {
                tracing::error!("BRPOP error: {e}");
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };

        let job: TileJob = match serde_json::from_str(&job_json) {
            Ok(j) => j,
            Err(e) => {
                tracing::error!("invalid job JSON: {e}");
                continue;
            }
        };

        tracing::info!(job_id = %job.job_id, "processing job");

        if job_should_stop(db, &job.job_id).await {
            bucket.delete_object(&upload_s3_key(&job.job_id)).await.ok();
            release_job_reservation(db, &job.job_id).await;
            continue;
        }

        let result = process_job(&job, bucket, conn, db).await;

        if let Err(e) = result {
            tracing::error!(job_id = %job.job_id, "job failed: {e}");
            let progress = JobProgress {
                status: "failed".into(),
                last_updated: unix_now(),
                user_id: job.user_id.clone(),
                error: Some(e.to_string()),
                ..Default::default()
            };
            let _: redis::RedisResult<()> = conn
                .set_ex(
                    progress_key(&job.job_id),
                    serde_json::to_string(&progress).unwrap(),
                    3600,
                )
                .await;
            let error = e.to_string();
            update_persistent_job(db, &job.job_id, PersistentJobUpdate {
                status: "failed",
                progress: 0,
                tiles_done: None,
                tiles_total: None,
                error: Some(&error),
                retry_count: Some(1),
            }).await;
            // Release storage reservation on failure
            release_job_reservation(db, &job.job_id).await;
        } else {
            bucket.delete_object(&upload_s3_key(&job.job_id)).await.ok();
        }
    }
}

// ---------------------------------------------------------------------------
// Process a single job
// ---------------------------------------------------------------------------

async fn process_job(
    job: &TileJob,
    bucket: &tileforge_shared::s3::Bucket,
    conn: &mut redis::aio::MultiplexedConnection,
    db: Option<&PgPool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let pkey = progress_key(&job.job_id);

    // Set initial processing status
    let initial = JobProgress {
        status: "processing".into(),
        last_updated: unix_now(),
        user_id: job.user_id.clone(),
        tiles_done: Some(0),
        tiles_total: Some(0),
        ..Default::default()
    };
    conn.set_ex::<_, _, ()>(&pkey, serde_json::to_string(&initial)?, 3600u64)
        .await?;
    update_persistent_job(db, &job.job_id, PersistentJobUpdate {
        status: "processing",
        progress: 0,
        tiles_done: Some(0),
        tiles_total: Some(0),
        error: None,
        retry_count: None,
    }).await;

    // Download image from S3
    let resp = bucket
        .get_object(&upload_s3_key(&job.job_id))
        .await
        .map_err(|e| format!("S3 download failed: {e}"))?;
    let image_bytes = resp.to_vec();
    let source_metadata = tileforge_core::read_geotiff_metadata(&image_bytes);

    // Check if we'll use streaming (to avoid double-decode for small images)
    let will_stream = should_use_streaming(&image_bytes, STREAMING_THRESHOLD);

    // For small images, decode once and reuse for both thumbnail and tiling
    // For large images, decode for thumbnail only (tiler will stream)
    let decoded_image = match image::load_from_memory(&image_bytes) {
        Ok(img) => {
            // Generate thumbnail (best-effort, don't fail the job)
            let thumb = img.thumbnail(480, 480);
            let mut jpeg_buf = Vec::new();
            let mut cursor = Cursor::new(&mut jpeg_buf);
            if let Ok(()) = thumb.write_to(&mut cursor, image::ImageFormat::Jpeg) {
                match bucket
                    .put_object(
                        &format!("{}/thumbnail.jpg", tile_s3_prefix(&job.job_id)),
                        &jpeg_buf,
                    )
                    .await
                {
                    Ok(_) => tracing::info!(job_id = %job.job_id, "thumbnail uploaded"),
                    Err(e) => tracing::warn!(job_id = %job.job_id, "thumbnail upload failed: {e}"),
                }
            }
            // Keep decoded image for small images to avoid re-decoding in tiler
            if will_stream { None } else { Some(img) }
        }
        Err(e) => {
            tracing::warn!(job_id = %job.job_id, "thumbnail decode failed: {e}");
            None
        }
    };

    let tile_size = job.tile_size.unwrap_or(256);
    let projection = match job.projection.as_deref() {
        Some("mercator") => Projection::Mercator,
        Some("isometric") => Projection::Isometric,
        None if source_metadata.as_ref().is_some_and(|metadata| metadata.is_global_geographic()) => {
            Projection::Mercator
        }
        _ => Projection::Flat,
    };
    let format = match job.format.as_deref() { Some("jpeg" | "jpg") => TileFormat::Jpeg, Some("webp") => TileFormat::Webp, _ => TileFormat::Png };

    let config = TileConfig {
        tile_size,
        min_zoom: job.min_zoom,
        max_zoom: job.max_zoom,
        projection,
        scale: job.scale,
        background: job.background_color.as_deref().and_then(BackgroundColor::from_hex),
        scale_metadata: None,
        format,
        quality: job.quality.unwrap_or(85).clamp(1, 100),
    };

    // Shared progress state: the blocking task writes here, a poller reads + publishes to Redis
    let shared_progress: Arc<Mutex<Option<TileProgress>>> = Arc::new(Mutex::new(None));
    let shared_done = Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Spawn a tokio task to poll shared_progress and write to Redis every 250ms
    let poller_conn = conn.clone();
    let poller_key = pkey.clone();
    let poller_progress = Arc::clone(&shared_progress);
    let poller_done = Arc::clone(&shared_done);
    let poller_user_id = job.user_id.clone();
    let poller_db = db.cloned();
    let poller_job_id = job.job_id.clone();
    let poller = tokio::spawn(async move {
        let mut conn = poller_conn;
        let mut last_db_update = Instant::now() - Duration::from_secs(2);
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;

            // Extract under the lock, then drop guard before awaiting
            let snapshot = { poller_progress.lock().unwrap().clone() };
            if let Some(p) = snapshot {
                let update = JobProgress {
                    status: "processing".into(),
                    last_updated: unix_now(),
                    user_id: poller_user_id.clone(),
                    zoom: Some(p.zoom),
                    tiles_done: Some(p.tiles_done),
                    tiles_total: Some(p.tiles_total),
                    ..Default::default()
                };
                let _: redis::RedisResult<()> = conn
                    .set_ex(
                        &poller_key,
                        serde_json::to_string(&update).unwrap(),
                        3600u64,
                    )
                    .await;
                if last_db_update.elapsed() >= Duration::from_secs(2) {
                    let percent = p.tiles_done.saturating_mul(100)
                        .checked_div(p.tiles_total)
                        .unwrap_or(0)
                        .min(99) as i32;
                    update_persistent_job(poller_db.as_ref(), &poller_job_id, PersistentJobUpdate {
                        status: "processing",
                        progress: percent,
                        tiles_done: Some(p.tiles_done as i64),
                        tiles_total: Some(p.tiles_total as i64),
                        error: None,
                        retry_count: None,
                    }).await;
                    last_db_update = Instant::now();
                }
            }

            if poller_done.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
        }
    });

    let min_zoom = config.min_zoom.unwrap_or(0);
    let max_zoom = config.max_zoom.unwrap_or(5);

    // Single-pass tiling: TeeTileWriter writes to both ZIP and PMTiles simultaneously
    let progress_writer = Arc::clone(&shared_progress);
    let (zip_bytes, pmtiles_bytes, img_width, img_height) = tokio::task::spawn_blocking(move || {
        let tiler = Tiler::new(config);

        // ZIP writer: in-memory
        let zip_writer = ZipTileWriter::with_format(Cursor::new(Vec::new()), format);

        // PMTiles writer: tempfile (finalize() consumes the writer)
        let tmp = tempfile::NamedTempFile::new()?;
        let file = tmp.reopen()?;
        let pmtiles_writer = PmTilesTileWriter::with_format(file, min_zoom as u8, max_zoom as u8, format)?;

        let mut tee = TeeTileWriter::new(zip_writer, pmtiles_writer);
        let last_write = Cell::new(Instant::now());
        let on_progress = |p: TileProgress| {
            let now = Instant::now();
            if p.tiles_done == 1
                || p.tiles_done == p.tiles_total
                || now.duration_since(last_write.get()).as_millis() >= 250
            {
                *progress_writer.lock().unwrap() = Some(p);
                last_write.set(now);
            }
        };

        // Use pre-decoded image if available (avoids double decode for small images)
        let output = if let Some(ref img) = decoded_image {
            tiler.process_image(img, &mut tee, on_progress)?
        } else {
            tiler.process_bytes(&image_bytes, &mut tee, on_progress)?
        };

        let (zip_w, _pmtiles_w) = tee.into_inner();
        let zip_bytes = zip_w.into_inner().unwrap().into_inner();
        let pmtiles_bytes = std::fs::read(tmp.path()).map_err(tileforge_core::TilerError::Io)?;

        Ok::<_, tileforge_core::TilerError>((zip_bytes, pmtiles_bytes, output.width, output.height))
    })
    .await??;

    // Signal poller to stop
    shared_done.store(true, std::sync::atomic::Ordering::Relaxed);
    poller.abort();
    let _ = poller.await;

    // Upload both artifacts to S3
    let prefix = tile_s3_prefix(&job.job_id);
    if job_should_stop(db, &job.job_id).await {
        release_job_reservation(db, &job.job_id).await;
        return Ok(());
    }
    bucket
        .put_object(&format!("{prefix}/tiles.zip"), &zip_bytes)
        .await
        .map_err(|e| format!("S3 ZIP upload failed: {e}"))?;

    tracing::info!(
        job_id = %job.job_id,
        zip_size = zip_bytes.len(),
        "ZIP uploaded to S3"
    );

    if job_should_stop(db, &job.job_id).await {
        bucket.delete_object(&format!("{prefix}/tiles.zip")).await.ok();
        release_job_reservation(db, &job.job_id).await;
        return Ok(());
    }

    bucket
        .put_object(&format!("{prefix}/tiles.pmtiles"), &pmtiles_bytes)
        .await
        .map_err(|e| format!("S3 PMTiles upload failed: {e}"))?;

    tracing::info!(
        job_id = %job.job_id,
        pmtiles_size = pmtiles_bytes.len(),
        "PMTiles uploaded to S3"
    );

    // Insert tile_set row if we have a user_id and DB connection
    if let (Some(user_id_str), Some(pool)) = (&job.user_id, db) {
        if let Ok(user_id) = uuid::Uuid::parse_str(user_id_str) {
            let tile_size_i32 = tile_size as i32;
            let min_zoom_i32 = job.min_zoom.unwrap_or(0) as i32;
            let max_zoom_i32 = job.max_zoom.unwrap_or(5) as i32;
            let name = job.file_name.as_ref()
                .map(|f| f.rsplit('/').next().unwrap_or(f))
                .map(|f| f.rsplit_once('.').map(|(n, _)| n).unwrap_or(f))
                .filter(|n| !n.is_empty())
                .map(|n| n.to_string())
                .unwrap_or_else(|| {
                    let short_id = &job.job_id[..8.min(job.job_id.len())];
                    format!("Tileset {short_id}")
                });
            let slug = &job.job_id;
            let projection = match job.projection.as_deref() {
                Some(value) => value,
                None if source_metadata.as_ref().is_some_and(|metadata| metadata.is_global_geographic()) => "mercator",
                None => "flat",
            };
            let storage_path = tile_s3_prefix(&job.job_id);
            let total_size = (zip_bytes.len() + pmtiles_bytes.len()) as i64;

            // Calculate tile count from zoom levels (i64 to avoid overflow at high zoom)
            let mut tile_count: i64 = 0;
            for z in min_zoom_i32..=max_zoom_i32 {
                let grid = 1i64 << z;
                tile_count += grid * grid;
            }

            let width_i32 = img_width as i32;
            let height_i32 = img_height as i32;

            let result = sqlx::query(
                "INSERT INTO tile_sets (user_id, name, slug, projection, tile_size, min_zoom, max_zoom, tile_count, size_bytes, storage_path, public, width, height, source_epsg, source_bounds, tile_format, tile_quality)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11, $12, $13, $14, $15, $16)
                 ON CONFLICT (user_id, slug) DO NOTHING",
            )
            .bind(user_id)
            .bind(&name)
            .bind(slug)
            .bind(projection)
            .bind(tile_size_i32)
            .bind(min_zoom_i32)
            .bind(max_zoom_i32)
            .bind(tile_count)
            .bind(total_size)
            .bind(&storage_path)
            .bind(width_i32)
            .bind(height_i32)
            .bind(source_metadata.as_ref().and_then(|metadata| metadata.epsg).map(i32::from))
            .bind(source_metadata.as_ref().and_then(|metadata| metadata.bounds.map(Vec::from)))
            .bind(job.format.as_deref().unwrap_or("png"))
            .bind(i16::from(job.quality.unwrap_or(85).clamp(1, 100)))
            .execute(pool)
            .await;

            match result {
                Ok(_) => tracing::info!(job_id = %job.job_id, "tile_set row inserted"),
                Err(e) => tracing::warn!(job_id = %job.job_id, "failed to insert tile_set row: {e}"),
            }

            // Release storage reservation (storage_used is updated via trigger on INSERT)
            release_job_reservation(db, &job.job_id).await;
        }
    }

    // Publish completion only after the database row exists. API consumers can
    // safely finalize its display metadata as soon as they observe this state.
    let final_progress = JobProgress {
        status: "complete".into(),
        last_updated: unix_now(),
        user_id: job.user_id.clone(),
        download_url: Some(format!("/api/tiles/{}/download", job.job_id)),
        pmtiles_url: Some(format!("/api/tiles/{}/download/pmtiles", job.job_id)),
        ..Default::default()
    };
    conn.set_ex::<_, _, ()>(&pkey, serde_json::to_string(&final_progress)?, 3600u64)
        .await?;
    update_persistent_job(db, &job.job_id, PersistentJobUpdate {
        status: "complete",
        progress: 100,
        tiles_done: None,
        tiles_total: None,
        error: None,
        retry_count: None,
    }).await;

    tracing::info!(job_id = %job.job_id, "job complete");

    Ok(())
}
