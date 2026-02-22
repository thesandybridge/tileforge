# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

**Start everything (Docker infra + all services via mprocs TUI):**
```bash
cargo xtask dev     # Ctrl+q to exit and auto-cleanup Docker
```

**Rust builds MUST use `--release`** — image processing is 10-100x slower in debug mode:
```bash
cargo build --release
cargo run --release --package tileforge-api
cargo run --release --package tileforge-worker
```

**Tests & Linting (matches CI):**
```bash
cargo test --release --workspace --exclude tileforge-wasm
cargo clippy --workspace --exclude tileforge-wasm -- -D warnings
```

Run a single test:
```bash
cargo test --release -p tileforge-api -- tests::health_returns_ok
```

**Web (Next.js 16 + Turbopack):**
```bash
cd web && npm run dev       # dev server
cd web && npm run build     # production build
cd web && npm run test:e2e  # Playwright E2E
```

## Architecture

**Rust workspace** (`crates/` + `cli/`):
- `core` — Tiling engine: `Tiler`, `TileWriter` trait (zip, pmtiles, tee), streaming decode, projections
- `shared` — Common types (`TileJob`, `JobProgress`), constants (Redis/NATS/S3 keys), `s3::bucket_from_env()`
- `api` — axum 0.8 HTTP server: handlers/{tiles,tilesets,user,api_keys,notifications,admin}, JWT+API key auth, rate limiting
- `worker` — Async job consumer (NATS JetStream primary, Redis BRPOP fallback), single-pass ZIP+PMTiles via `TeeTileWriter`
- `wasm` — Browser bindings (wasm-pack `--target no-modules`, output committed to `web/public/wasm/`)
- `cli` — Native CLI binary (clap)

**Web frontend** (`web/`): Next.js 16 App Router, TypeScript strict, Tailwind v4, shadcn/ui (`@thesandybridge/ui`), React Query, Auth.js v5 (GitHub OAuth)

**Data flow — async tile processing:**
1. `POST /api/tiles` → upload to S3, publish `TileJob` to NATS/Redis → 202 + job_id
2. Worker consumes job → downloads from S3 → `TeeTileWriter` (ZIP + PMTiles) → uploads to S3 → `JobProgress` to Redis
3. `GET /api/tiles/{id}/progress` (SSE) → polls Redis, client auto-downloads on complete

**S3 key layout:**
```
uploads/{job_id}.bin                    # temp upload (deleted after processing)
tiles/{job_id}/tiles.zip                # ZIP output
tiles/{job_id}/tiles.pmtiles            # PMTiles output
tiles/{job_id}/thumbnail.jpg            # 480px JPEG
```

**Auth:** HS256 JWT shared between Next.js and Rust API. Three levels: anon, free, pro. API keys (`tf_...` prefix) are Pro-only.

**Database:** Postgres with sqlx migrations auto-applied on API startup (`crates/api/migrations/`). Tables: users, tile_sets, api_keys, notifications.

## Key Patterns

- **Raw body + query params** for image uploads (not multipart — broken through Next.js proxy)
- **Next.js rewrites** proxy `/api/*` to Rust API (route handlers can't proxy large bodies)
- **Presigned S3 URLs** for downloads (307 redirect, not in-memory loading)
- **`spawn_blocking`** for all image processing to avoid blocking tokio runtime
- **WASM + Web Worker** are plain scripts in `web/public/` (Turbopack can't bundle WASM in workers)

## Environment

Dev infra from `docker-compose.yml`: Postgres 17 (:5433), Redis 7 (:6380), MinIO (:9000), NATS (:4222).

Required env vars: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Web additionally needs `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, Stripe keys.

## Conventions

- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `build:`, `perf:`
- No Co-Authored-By lines in commits
- Deployment: Railway (private networking between services)
- Dockerfiles exist per service (`crates/api/Dockerfile`, `crates/worker/Dockerfile`, `web/Dockerfile`) — all must include `crates/shared` as a workspace member
