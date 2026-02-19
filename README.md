<p align="center">
  <img src="web/app/icon.svg" width="80" height="80" alt="Tileforge logo" />
</p>

<h1 align="center">Tileforge</h1>

<p align="center">
  Slice any image into <a href="https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames">XYZ map tiles</a> — entirely in your browser, powered by Rust and WebAssembly.
</p>

<p align="center">
  <a href="https://github.com/thesandybridge/tileforge/actions"><img src="https://github.com/thesandybridge/tileforge/actions/workflows/wasm-build.yml/badge.svg" alt="WASM Build" /></a>
  <img src="https://img.shields.io/badge/rust-stable-orange" alt="Rust" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
</p>

---

## What is Tileforge?

Tileforge takes a single large image and slices it into a directory tree of small square tiles organized as `{zoom}/{x}/{y}.png` — the standard XYZ tile format used by Leaflet, Mapbox GL, OpenLayers, and every major mapping library.

**No server-side processing.** The web UI runs the entire pipeline in a Web Worker using compiled-to-WASM Rust. Your images never leave your machine.

There's also a native CLI for batch processing and scripting.

---

## Features

- **Browser-based** — drop an image, configure, download a ZIP of tiles. Zero server uploads.
- **Server-side processing** — Pro users can offload processing to a native Rust API for larger images and higher zoom levels.
- **Rust + WebAssembly** — native-speed image processing compiled to WASM via `wasm-pack`.
- **Three processing strategies** — automatically selected based on image size:
  | Strategy | When | Memory |
  |---|---|---|
  | **Naive** | Small images (< 256 MB decoded) | Full decode + resize per zoom |
  | **Streaming PNG** | Large PNGs | Row-by-row decode, never holds full image |
  | **Strip extraction** | Large JPEG/WebP | Full decode, but no per-zoom resized copies |
- **Flat and Mercator projections** — flat/equirectangular for fictional maps and artwork; Web Mercator (EPSG:3857) for real-world geographic maps from equirectangular sources.
- **ZIP and PMTiles output** — download tiles as ZIP or as a single [PMTiles](https://protomaps.com/docs/pmtiles) archive for efficient web serving.
- **Single-pass processing** — TeeWriter generates ZIP + PMTiles simultaneously in one pass over the tiles.
- **PMTiles preview** — tileset detail page streams only visible tiles via HTTP range requests instead of downloading the full archive.
- **Thumbnail generation** — worker auto-generates a 480px JPEG thumbnail for each tileset.
- **Interactive tile preview** — rendered with Leaflet directly from in-memory tiles. Available on both the home page (after processing) and tileset detail pages.
- **Tileset gallery** — browse public tilesets with thumbnail previews. Manage your own tilesets with rename, visibility toggle, and delete.
- **GitHub OAuth** — sign in with GitHub. JWT-based auth shared between Next.js and the Rust API.
- **API keys** — Pro users can generate `tf_...` bearer tokens for programmatic access to their tilesets.
- **Notifications** — in-app notification system with DB-backed storage for Pro users.
- **Rate limiting** — per-IP rate limits on all API endpoints via Redis.
- **Account management** — deactivation with 30-day grace period and admin purge.
- **Configurable** — tile size (128/256/512), min/max zoom, projection type.
- **Pyramid builder** — lower zoom levels are built by merging 4 tiles into 1, cascading from max zoom down to zoom 0.
- **CLI tool** — native binary for scripting and batch jobs.
- **Dark mode** — green-tinted dark theme with amber accents (light mode supported too).

---

## Architecture

```
tileforge/
├── Cargo.toml                       # Workspace root
├── crates/
│   ├── core/src/                    # Tiling engine (Tiler, ZipTileWriter, PmTilesTileWriter, TeeTileWriter)
│   ├── api/src/main.rs              # HTTP API (axum) — tiles, downloads, CRUD, auth, notifications, API keys
│   ├── worker/src/main.rs           # Background worker — async jobs, thumbnail generation
│   └── wasm/src/lib.rs              # WASM bindings for crates/core
├── cli/src/main.rs                  # Native CLI binary
└── web/                             # Next.js 16 + Tailwind v4 + shadcn/ui
    ├── app/
    │   ├── layout.tsx               # Root layout, navbar, SEO metadata
    │   ├── page.tsx                 # Main UI: drop zone, config, progress, download
    │   ├── gallery/page.tsx         # Public tileset gallery with thumbnails
    │   ├── my-tilesets/page.tsx     # Authenticated user's tilesets
    │   ├── tilesets/[slug]/         # Tileset detail: metadata, PMTiles preview, code snippets
    │   ├── settings/page.tsx        # User settings: API keys, notifications, account
    │   └── billing/page.tsx         # Stripe billing portal
    ├── components/
    │   ├── tile-preview.tsx         # Leaflet-based in-memory tile viewer (ZIP)
    │   ├── pmtiles-preview.tsx      # Leaflet tile layer backed by PMTiles range requests
    │   ├── api-key-card.tsx         # API key generation and display
    │   ├── notification-panel.tsx   # Notification dropdown panel
    │   ├── notification-context.tsx # Notification state provider
    │   ├── upgrade-banner.tsx       # Pro upgrade prompt
    │   ├── navbar.tsx               # Site navigation with auth
    │   └── user-menu.tsx            # GitHub OAuth sign in/out
    ├── hooks/
    │   ├── use-tilesets.ts          # Tileset CRUD + PMTiles preview hooks
    │   ├── use-api-key.ts           # API key management hook
    │   ├── use-user.ts              # Current user hook
    │   └── use-deactivate.ts        # Account deactivation hook
    ├── lib/
    │   ├── api.ts                   # API client (tilesets, keys, notifications, user)
    │   ├── notifications.ts         # Notification types and helpers
    │   └── plans.ts                 # Plan definitions and limits
    └── public/
        ├── tileforge.worker.js      # Standalone Web Worker (importScripts, no bundler)
        └── wasm/                    # wasm-pack output (--target no-modules)
```

### Services

| Service    | Purpose                                                       |
|------------|---------------------------------------------------------------|
| **web**    | Next.js 16 — UI, auth (Auth.js v5), SSR                      |
| **api**    | Rust (axum) — tile processing, downloads, CRUD, auth, rate limiting |
| **worker** | Rust — async job consumer, thumbnail generation               |
| NATS       | JetStream job queue — durable publish, explicit ack, retry/DLQ |
| Redis      | Progress cache + rate limiting (job queue fallback if no NATS) |
| Postgres   | Users, tile sets, notifications, API keys                     |
| S3         | Tile storage (ZIP, PMTiles, thumbnails, uploads)              |

### S3 Key Layout

```
uploads/{job_id}.bin              # Temporary upload (deleted after processing)
tiles/{job_id}/tiles.zip          # ZIP output
tiles/{job_id}/tiles.pmtiles      # PMTiles output
tiles/{job_id}/thumbnail.jpg      # 480px JPEG thumbnail
```

### Why the WASM Worker lives in `public/`

Turbopack cannot bundle WASM imports inside Web Workers. The worker and WASM glue are plain scripts in `public/`, loaded via `importScripts()`. The React hook creates the worker with `new Worker("/tileforge.worker.js")`.

---

## Getting Started

### Prerequisites

- **Rust** (stable) — [rustup.rs](https://rustup.rs/)
- **wasm-pack** — `cargo install wasm-pack`
- **Node.js** 20+ and **npm**
- **Docker** — for Postgres, MinIO, Redis, and NATS
- **[mprocs](https://github.com/pvolok/mprocs)** — `cargo install mprocs` (tabbed TUI for running services)
- **Stripe CLI** — `brew install stripe/stripe-cli/stripe` (for webhook testing)

### Local Dev Quickstart

**1. Create env files:**

- `.env` in the project root with Rust service variables:

```env
DATABASE_URL=postgres://tileforge:tileforge@localhost:5433/tileforge
REDIS_URL=redis://127.0.0.1:6380
NATS_URL=nats://127.0.0.1:4222
JWT_SECRET=<shared-secret>
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=tileforge
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
```

- `web/.env.local` with Next.js variables:

```env
DATABASE_URL=postgres://tileforge:tileforge@localhost:5433/tileforge
AUTH_SECRET=<random-string>
AUTH_GITHUB_ID=<your-github-oauth-app-id>
AUTH_GITHUB_SECRET=<your-github-oauth-app-secret>
JWT_SECRET=<shared-secret>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
```

**2. Start everything:**

```bash
cargo xtask dev
```

This will:
- Start Docker infrastructure (Postgres, Redis, MinIO, NATS) and wait for readiness
- Install web dependencies if needed
- Launch [mprocs](https://github.com/pvolok/mprocs) with tabbed views for **api**, **worker**, **web**, and **stripe**

Use the mprocs TUI to switch between service logs. Ctrl+q exits and automatically stops Docker containers.

> **Important:** Rust services are compiled with `--release` — image processing is 10-100x slower in debug mode.

Open [http://localhost:3000](http://localhost:3000).

### Building from scratch

```bash
git clone https://github.com/thesandybridge/tileforge.git
cd tileforge
```

#### Build the Rust library and CLI

```bash
cargo build --release
```

#### Build WASM for the web UI

```bash
cd crates/wasm
wasm-pack build --target no-modules --out-dir ../../web/public/wasm --release
```

#### Run just the web UI (browser-only mode, no server deps)

```bash
cd web && npm install && npm run dev
```

Requires Redis and S3 to be configured. See environment variables below.

### Environment Variables

#### Rust API (`crates/api`)

| Variable          | Required | Default                | Description                       |
|-------------------|----------|------------------------|-----------------------------------|
| `PORT`            | No       | `8080`                 | HTTP listen port                  |
| `MAX_UPLOAD_BYTES`| No       | `524288000` (500 MB)   | Max image upload size             |
| `REDIS_URL`       | No       | —                      | Redis URL (enables progress + rate limiting) |
| `NATS_URL`        | No       | —                      | NATS URL (enables JetStream job queue; falls back to Redis) |
| `DATABASE_URL`    | No       | —                      | Postgres URL (enables tileset CRUD) |
| `CORS_ORIGIN`     | No       | `*` (permissive)       | Allowed CORS origin               |
| `JWT_SECRET`      | No       | —                      | Shared HS256 secret for JWT auth  |
| `S3_ENDPOINT`     | No       | —                      | S3-compatible endpoint URL        |
| `S3_BUCKET`       | No       | —                      | S3 bucket name                    |
| `S3_ACCESS_KEY`   | No       | —                      | S3 access key                     |
| `S3_SECRET_KEY`   | No       | —                      | S3 secret key                     |
| `S3_REGION`       | No       | `us-east-1`            | S3 region                         |
| `ADMIN_SECRET`    | No       | —                      | Secret for admin-only endpoints (purge) |

#### Worker (`crates/worker`)

| Variable       | Required | Default                  | Description                  |
|----------------|----------|--------------------------|------------------------------|
| `REDIS_URL`    | No       | `redis://127.0.0.1:6380` | Redis URL (progress tracking)  |
| `NATS_URL`     | No       | —                        | NATS URL (JetStream job queue; falls back to Redis BRPOP) |
| `DATABASE_URL` | No       | —                        | Postgres (for tileset rows)  |
| `S3_ENDPOINT`  | Yes      | —                        | S3-compatible endpoint URL   |
| `S3_BUCKET`    | Yes      | —                        | S3 bucket name               |
| `S3_ACCESS_KEY`| Yes      | —                        | S3 access key                |
| `S3_SECRET_KEY`| Yes      | —                        | S3 secret key                |
| `S3_REGION`    | No       | `us-east-1`              | S3 region                    |

#### Next.js (`web/`)

| Variable                | Required | Default                | Description                        |
|-------------------------|----------|------------------------|------------------------------------|
| `NEXT_PUBLIC_API_URL`   | No       | `http://localhost:8080` | Rust API URL (client-side)        |
| `AUTH_SECRET`           | No       | —                      | NextAuth session encryption secret |
| `AUTH_GITHUB_ID`        | No       | —                      | GitHub OAuth app client ID         |
| `AUTH_GITHUB_SECRET`    | No       | —                      | GitHub OAuth app client secret     |
| `JWT_SECRET`            | No       | —                      | Shared HS256 secret for API JWTs   |
| `DATABASE_URL`          | No       | —                      | Postgres (for Auth.js user store)  |

### API Endpoints

| Method | Path                                | Auth     | Description                                 |
|--------|-------------------------------------|----------|---------------------------------------------|
| GET    | `/health`                           | No       | Health check                                |
| POST   | `/api/tiles`                        | Optional | Process image into tiles                    |
| GET    | `/api/tiles/{id}/progress`          | No       | SSE progress stream                         |
| GET    | `/api/tiles/{id}/download`          | Required | Download tiles as ZIP (presigned redirect)  |
| GET    | `/api/tiles/{id}/download/pmtiles`  | Required | Download tiles as PMTiles (presigned redirect) |
| GET    | `/api/tiles/{id}/thumbnail`         | No       | Tileset thumbnail (JPEG)                    |
| GET    | `/api/tilesets`                     | Optional | List tilesets (paginated)                   |
| POST   | `/api/tilesets`                     | Required | Create tileset                              |
| GET    | `/api/tilesets/{slug}`              | Optional | Get tileset details                         |
| PATCH  | `/api/tilesets/{slug}`              | Required | Update tileset                              |
| DELETE | `/api/tilesets/{slug}`              | Required | Delete tileset + S3 cleanup                 |
| GET    | `/api/tilesets/{slug}/pmtiles-url`  | Optional | Presigned PMTiles URL for range requests    |
| GET    | `/api/user`                         | Required | Current user info + storage usage           |
| POST   | `/api/user/deactivate`              | Required | Deactivate account                          |
| POST   | `/api/user/reactivate`              | Required | Reactivate within 30-day grace period       |
| POST   | `/api/admin/purge-deactivated`      | Admin    | Purge accounts deactivated > 30 days        |
| GET    | `/api/notifications`                | Required | List notifications                          |
| POST   | `/api/notifications`                | Required | Create notification                         |
| POST   | `/api/notifications/read`           | Required | Mark all notifications as read              |
| DELETE | `/api/notifications`                | Required | Clear all notifications                     |
| POST   | `/api/keys`                         | Required | Create API key (Pro only)                   |
| GET    | `/api/keys`                         | Required | Get current API key                         |
| DELETE | `/api/keys`                         | Required | Revoke API key                              |

---

## CLI Usage

```bash
tileforge <IMAGE> [OPTIONS]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `-o, --output <PATH>` | `tiles.zip` | Output ZIP file path |
| `-t, --tile-size <PX>` | `256` | Tile size in pixels |
| `--min-zoom <N>` | `0` | Minimum zoom level |
| `--max-zoom <N>` | auto | Maximum zoom level (calculated from image dimensions) |
| `--projection <TYPE>` | `flat` | `flat` or `mercator` |
| `--streaming` | | Force streaming mode (lower memory) |
| `--naive` | | Force naive mode (faster for small images) |

### Examples

```bash
# Basic usage — auto-selects processing strategy
tileforge world_map.png -o tiles.zip

# Mercator projection for an equirectangular world map
tileforge equirect_world.png -o mercator_tiles.zip --projection mercator

# Custom tile size and zoom range
tileforge large_image.jpg -o tiles.zip --tile-size 512 --max-zoom 6

# Force streaming mode for a huge PNG
tileforge huge.png -o tiles.zip --streaming
```

### Output format

```
tiles.zip
├── 0/0/0.png        # Zoom 0: 1 tile
├── 1/0/0.png        # Zoom 1: 4 tiles
├── 1/0/1.png
├── 1/1/0.png
├── 1/1/1.png
├── 2/0/0.png        # Zoom 2: 16 tiles
├── ...
```

Compatible with Leaflet, Mapbox GL JS, OpenLayers, MapLibre, Google Maps, and any library that supports XYZ tile URLs.

---

## Web UI

1. **Drop or browse** for an image (PNG, JPEG, WebP)
2. **Configure** tile size, max zoom level, and projection
3. **Process** — runs entirely in a Web Worker via WASM
4. **Preview** — interactive Leaflet map rendered from the in-memory tiles
5. **Download** — single ZIP file ready to deploy

The web UI shows real-time progress (zoom level, tile count, percentage) and post-processing stats (duration, tile count, peak memory estimate).

---

## Projections

### Flat (default)

Standard equirectangular mapping. Each zoom level uniformly scales the source image to fit the tile grid. Suitable for:
- Fantasy/game maps
- Floor plans and architectural drawings
- Artwork and illustrations
- Any non-geographic image

### Mercator

Web Mercator (EPSG:3857) Y-axis remapping. Assumes the source image is an equirectangular (plate carree) projection spanning approximately ±85.051° latitude. Tiles are warped so that equal-size tile rows cover equal Mercator-projected latitude bands. Suitable for:
- Real-world geographic maps
- Satellite imagery in equirectangular format
- Any source intended for use with standard web mapping libraries

The X axis is unchanged between projections — both are linear in longitude.

---

## How It Works

### Processing strategies

**Naive** (small images): Decode the full image, resize to each zoom level's canvas size, crop tiles from the canvas. Simple and fast for images under ~256 MB decoded.

**Streaming PNG** (large PNGs): Decode the PNG row-by-row using the `png` crate. For each tile row at max zoom, decode only the source rows needed, extract tiles, then release the rows. Lower zoom levels are built by merging tiles (4 → 1) using a pyramid builder. Peak memory is roughly one tile row's worth of source data.

**Strip extraction** (large non-PNGs): Fully decode the image (unavoidable for JPEG), but never create resized copies. Each tile is individually cropped and resampled from the source. Pyramid builder handles lower zoom levels.

### Pyramid builder

Instead of creating full-canvas images at every zoom level, the pyramid builder merges tiles bottom-up:
1. Generate all tiles at max zoom
2. Every pair of tile rows triggers a merge: 4 tiles (2x2) are composited into a 2x tile and downscaled to 1 tile at zoom-1
3. Merges cascade recursively down to zoom 0

This means lower zoom levels are generated with no additional source image access.

---

## CI/CD

A GitHub Actions workflow (`.github/workflows/wasm-build.yml`) automatically rebuilds the WASM output whenever files under `crates/` change on the `main` branch. The built artifacts are committed back to `web/public/wasm/`.

---

## Tech Stack

| Component | Technology |
|---|---|
| Core library | Rust (`image`, `png`, `zip`, `pmtiles`, `thiserror`) |
| HTTP API | Rust + axum, tower-http |
| Worker | Rust + async-nats, redis, rust-s3, sqlx |
| WASM bridge | `wasm-bindgen`, `js-sys`, `wasm-pack` |
| CLI | Rust + `clap` |
| Web framework | Next.js 16 (App Router, Turbopack) |
| Auth | Auth.js v5 (GitHub OAuth), HS256 JWT |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Map preview | Leaflet + react-leaflet + pmtiles |
| ZIP (browser) | fflate |
| Database | PostgreSQL + sqlx migrations |
| Queue | NATS JetStream (durable job queue with retry/DLQ; Redis BRPOP fallback) |
| Storage | S3-compatible (Railway bucket / MinIO) |
| CI | GitHub Actions |

---

## License

[MIT](LICENSE)

---

<p align="center">
  Made with ♥ by <a href="https://github.com/thesandybridge">sandybridge</a>
</p>
