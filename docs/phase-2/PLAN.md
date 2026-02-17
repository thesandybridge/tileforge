# Phase 2: Redis Job Queue + Worker

## Context

Phase 1 deployed a synchronous Rust API — every image upload blocks the HTTP handler until processing completes. This works for small images but fails for large ones: the request times out, the API thread is blocked, and there's no progress feedback. Phase 2 adds async job processing so large images are enqueued to Redis, processed by a dedicated worker, with real-time SSE progress.

**Threshold**: images whose decoded size (`w * h * 4`) exceeds `STREAMING_THRESHOLD` (256 MB) go async. A 50 MB JPEG of a 10000x8000 photo decodes to ~305 MB — file size alone is misleading.

---

## Architecture

```
POST /api/tiles (image bytes)
    │
    ├─ small image (decoded < 256MB) → process inline → return ZIP (unchanged)
    │
    └─ large image (decoded ≥ 256MB) → save to /data/uploads/{job_id}.bin
                                      → LPUSH job to Redis
                                      → return 202 { job_id }

Worker (BRPOP tileforge:jobs)
    → read /data/uploads/{job_id}.bin
    → process tiles
    → write /data/tiles/{job_id}/tiles.zip
    → publish progress to Redis (throttled)
    → set status = complete

GET /api/tiles/{job_id}/progress → SSE stream reading Redis progress
GET /api/tiles/{job_id}/download → serve ZIP from /data/tiles/{job_id}/tiles.zip
```

---

## Redis Schema

```
Queue:    LPUSH tileforge:jobs <job JSON>
          BRPOP tileforge:jobs 0 (worker)

Progress: SET tileforge:progress:{job_id} <progress JSON> EX 3600

Job JSON: { "job_id", "image_key", "tile_size", "max_zoom", "min_zoom", "projection" }
Progress JSON: { "status": "queued|processing|complete|failed", "zoom", "tiles_done", "tiles_total", "download_url", "error" }
```

## Tasks

| # | Task | Description |
|---|---|---|
| 2.0 | Write Phase 2 plan to docs | This file + update TASKS.md |
| 2.1 | Add `crates/worker` to workspace | Root Cargo.toml |
| 2.2 | Create `crates/worker/Cargo.toml` | Dependencies: tileforge-core, redis, tokio, serde, uuid, tracing |
| 2.3 | Create `crates/worker/src/main.rs` | BRPOP loop, process jobs, throttled progress to Redis |
| 2.4 | Create `crates/worker/Dockerfile` | Multi-stage build, same pattern as api |
| 2.5 | Modify API — async threshold + job enqueue | Threshold check, upload to disk, enqueue, 202 response |
| 2.6 | Modify API — SSE progress + download endpoints | Poll Redis progress via SSE, serve ZIP from disk |
| 2.7 | Update web rewrites | next.config.ts: progress + download rewrites |
| 2.8 | Update use-tileforge.ts | Handle 202, EventSource SSE, download on complete |
| 2.9 | Update docs | Mark Phase 2 done in TASKS.md and TDD.md |

## Key Decisions

- **Threshold**: dimension-based (`w * h * 4 > 256MB`), not file size. Reuses `should_use_streaming()` from core.
- **Progress throttle**: worker writes to Redis at most every 250ms via a separate tokio task polling an `Arc<Mutex<TileProgress>>`.
- **Storage**: Railway volume at `/data`, shared by api and worker. `STORAGE_PATH` env var.
- **Cleanup**: worker deletes uploaded .bin after processing. Progress keys expire after 1 hour (Redis TTL).

## Local Dev Setup

- Redis: `docker run -d --name redis -p 6379:6379 redis:7-alpine`
- `REDIS_URL=redis://127.0.0.1:6379` for both api and worker
- `STORAGE_PATH=/tmp/tileforge` (or any local dir)
- Run API: `cargo run --release -p tileforge-api`
- Run Worker: `cargo run --release -p tileforge-worker`
