# TileForge — Technical Design Document

## Overview

Extend TileForge from a client-only Next.js app into a multi-service architecture on Railway. The core product stays free (client-side WASM tiling), while paid tiers unlock server-side processing, hosted tile serving, and persistent storage.

---

## Current Architecture

```
Railway (single service)
└── web/  Next.js 16 — static SPA, all processing in a Web Worker via WASM
```

No API routes, no database, no backend. The Rust `crates/core` library is only consumed via `crates/wasm`.

---

## Target Architecture

```
                          ┌─────────────┐
                          │ Cloudflare   │ CDN + DNS (tileforge.sandybridge.io)
                          │ (edge cache) │ immutable tile cache, zero egress
                          └──────┬───────┘
                                 │
Railway project ─────────────────┼──────────────────────────────
                                 │
├── web            Next.js 16 — UI, API routes, Stripe webhooks, auth
├── api            Rust (axum) — tile processing HTTP API, tile serving
├── worker         Rust — job consumer, reads from Redis, writes tiles to volume
├── redis          Railway managed Redis — job queue + progress cache
├── postgres       Railway managed Postgres — users, tile sets, billing state
└── volume         Railway persistent volume (/data) — mounted to api + worker
```

---

## Phase 1: Rust API Service

### Goal

Deploy `crates/core` as a native Rust HTTP server alongside the Next.js app. Server-side processing is faster than WASM, supports larger images, and has full threading.

### Scope

- New crate: `crates/api` (axum)
- Single endpoint: `POST /api/tiles` — accepts raw image bytes + query param config, returns ZIP
- Reuses `tileforge-core` directly (same `Tiler::process_bytes`)
- SSE progress deferred to Phase 2 — UI shows spinner for server mode
- Next.js rewrites proxy requests to the Rust API

### New Crate

```
crates/api/
├── Cargo.toml        # axum, tokio, tower-http, tileforge-core, serde
├── src/
│   └── main.rs       # Server startup, router, config, all in one file (~170 lines)
└── Dockerfile        # Multi-stage: cargo build --release, debian:bookworm-slim runtime
```

### API Contract

```
POST /api/tiles?tile_size=256&max_zoom=4&projection=flat
Content-Type: application/octet-stream
Body: <raw image bytes>

Query params (all optional):
  tile_size:   128 | 256 | 512       (default: 256)
  min_zoom:    0+                     (default: auto)
  max_zoom:    0+                     (default: auto)
  projection:  "flat" | "mercator"   (default: "flat")

Response: 200 OK
Content-Type: application/zip
Content-Disposition: attachment; filename="tiles.zip"
```

For large images (async path, Phase 2):
```
POST /api/tiles
→ 202 Accepted { "job_id": "uuid" }

GET /api/tiles/{job_id}/progress
→ SSE stream: { "status": "processing", "zoom": 3, "tiles_done": 40, "tiles_total": 85 }
→ Final event: { "status": "complete", "download_url": "/api/tiles/{job_id}/download" }
```

### Web Integration

- Next.js `rewrites()` in `next.config.ts` proxies `/api/tiles` → Rust API (no custom route handler)
- `experimental.proxyClientMaxBodySize: "500mb"` to support large uploads through the proxy
- `use-tileforge.ts` has `processServer()` — POSTs raw bytes to `/api/tiles?params`
- UI toggle: "Local WASM" vs "Server" mode selector
- Server mode: spinner + "Processing on server..." (no granular progress in Phase 1)
- Server mode: no max zoom cap (zoom levels 0-12 available)

### Railway Config

- New service `api` with its own `Dockerfile` — configure via Railway dashboard (no `railway.toml`)
- Private networking: `web` calls `api.railway.internal:8080` via `API_URL` env var
- Health check on `GET /health`
- Env vars: `PORT`, `MAX_UPLOAD_BYTES`

### Tasks

- [x] Scaffold `crates/api` with axum
- [x] `POST /api/tiles` — sync processing, return ZIP (raw body + query params)
- [x] `GET /health` endpoint
- [x] Dockerfile (multi-stage Rust build, all workspace members stubbed)
- [x] Next.js rewrite proxy (`next.config.ts`)
- [x] Add `processServer()` to `use-tileforge.ts`
- [x] UI toggle for local vs server processing (spinner for server mode)
- [x] End-to-end test: both paths through web UI

---

## Phase 2: Redis Job Queue + Worker

### Goal

Move server-side processing to a background worker for large images. The API becomes a thin submission layer, Redis is the queue, and a dedicated worker crate processes jobs.

### Scope

- Railway managed Redis (one-click addon)
- New crate: `crates/worker` — long-running process that consumes jobs from Redis
- API enqueues jobs instead of processing synchronously for large uploads
- Progress published to Redis, polled via SSE from the API

### Architecture

```
User → web → api (POST /api/tiles)
                  │
                  ├─ small image → process inline, return ZIP
                  │
                  └─ large image → enqueue to Redis → 202 Accepted
                                        │
                                     worker (consumes job)
                                        │
                                     writes ZIP to volume/S3
                                        │
                                     updates progress in Redis
                                        │
                  api (GET /progress) ←──┘ reads progress from Redis
```

### Job Schema (Redis)

```json
// Queue: LPUSH tileforge:jobs
{
  "job_id": "uuid",
  "image_key": "uploads/{job_id}.bin",
  "tile_size": 256,
  "max_zoom": 5,
  "projection": "flat",
  "user_id": "user_123",
  "created_at": "2026-02-16T00:00:00Z"
}

// Progress: SET tileforge:progress:{job_id}
{
  "status": "processing",  // queued | processing | complete | failed
  "zoom": 3,
  "tiles_done": 40,
  "tiles_total": 85,
  "download_url": null      // set on completion
}

// TTL: 1 hour after completion
```

### New Crate

```
crates/worker/
├── Cargo.toml       # tileforge-core, redis, tokio, serde, uuid, tracing
├── src/
│   ├── main.rs      # BRPOP loop, job dispatch
│   └── processor.rs # Deserialize job, run tiler, write output, update progress
└── Dockerfile
```

### Upload Flow

1. API receives image, writes to temp storage (Railway volume at `/data/uploads/`)
2. Enqueues job to Redis with `image_key` pointing to the file
3. Worker picks up job via `BRPOP`, reads image from volume, processes, writes ZIP to `/data/tiles/{job_id}/tiles.zip`
4. Worker sets progress to `complete` with `download_url`
5. API serves download from volume on `GET /api/tiles/{job_id}/download`
6. Cron or TTL cleanup removes old files

### Tasks

- [x] Provision Railway Redis
- [ ] Shared Railway volume mounted to both `api` and `worker`
- [x] Scaffold `crates/worker` with BRPOP loop
- [x] API: upload image to volume, enqueue job
- [x] API: SSE progress endpoint reads from Redis
- [x] API: download endpoint serves ZIP from volume
- [x] Worker: consume job, process, write output, update progress
- [x] Async threshold logic: use decoded dimension estimate (`w * h * 4`), not raw file size — a 50MB JPEG can decode to a much larger bitmap than a 50MB PNG. Reuse the same `STREAMING_THRESHOLD` (256MB decoded) logic from `crates/core`
- [x] Job TTL / cleanup for expired results
- [x] Stale job detection: `last_updated` timestamp, API returns failed if >5min stale
- [ ] Integration test: submit large job, poll progress, download result

---

## Phase 3: PostgreSQL — Users, Tile Sets, Billing

### Goal

Persistent metadata layer. Track users, their tile sets, and billing state. Required foundation for auth (Phase 5) and paid tile serving (Phase 4).

### Scope

- Railway managed Postgres (one-click addon)
- Schema for users, tile sets, and Stripe subscription state
- Next.js API routes for CRUD operations
- Migrations via a simple tool (dbmate, sqlx-cli, or raw SQL files)

### Schema

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id       BIGINT UNIQUE NOT NULL,
    username        TEXT NOT NULL,
    email           TEXT,
    avatar_url      TEXT,
    stripe_customer_id TEXT UNIQUE,
    plan            TEXT NOT NULL DEFAULT 'free',  -- free | pro
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tile_sets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL,             -- URL-safe identifier
    projection      TEXT NOT NULL DEFAULT 'flat',
    tile_size       INT NOT NULL DEFAULT 256,
    min_zoom        INT NOT NULL DEFAULT 0,
    max_zoom        INT NOT NULL,
    tile_count      INT NOT NULL,
    size_bytes       BIGINT NOT NULL,
    storage_path    TEXT NOT NULL,              -- volume or S3 path
    public          BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(user_id, slug)
);

CREATE INDEX idx_tile_sets_user ON tile_sets(user_id);
CREATE INDEX idx_tile_sets_public ON tile_sets(public) WHERE public = true;
```

### API Routes (Next.js)

```
GET    /api/tilesets              — list current user's tile sets
POST   /api/tilesets              — create metadata entry after processing
GET    /api/tilesets/[slug]       — get tile set details
DELETE /api/tilesets/[slug]       — delete tile set + storage
PATCH  /api/tilesets/[slug]       — update name, public flag
```

### Tasks

- [ ] Provision Railway Postgres
- [ ] Choose migration tool (sqlx-cli recommended since the stack is Rust-heavy)
- [ ] Write initial migration (users + tile_sets tables)
- [ ] Database connection pool in api crate (sqlx + PgPool)
- [ ] Next.js API routes for tile set CRUD
- [ ] Wire worker to insert tile_set row on job completion
- [ ] Gallery page: list public tile sets

---

## Phase 4: Tile Server — Hosted Tile Serving

### Goal

Serve tiles as live `{z}/{x}/{y}.png` URLs so users can plug them directly into Leaflet, Mapbox, MapLibre, etc. This is the core paid feature.

### Scope

- New endpoint: `GET /tiles/{user}/{slug}/{z}/{x}/{y}.png`
- Tiles served from Railway volume or S3
- Free tier: client-side WASM only, download ZIP
- Pro tier: server processing + hosted tiles with a shareable URL

### Tile Serving Endpoint

```
GET /tiles/:username/:slug/:z/:x/:y.png

Headers:
  Cache-Control: public, max-age=31536000, immutable
  Content-Type: image/png

404 if tile doesn't exist
403 if tile set is private and requester is not the owner
```

### Storage Layout (Railway Volume)

```
/data/tiles/
└── {user_id}/
    └── {tileset_id}/
        ├── 0/0/0.png
        ├── 1/0/0.png
        ├── 1/0/1.png
        └── ...
```

Tiles are stored individually on disk (not in a ZIP) for direct serving. The worker extracts tiles from the ZIP into this structure on job completion.

**Start with Railway volumes.** Single-replica is fine at launch, and adding S3 before there are paying users is premature complexity. The storage path is abstracted behind `STORAGE_PATH`, making future migration straightforward.

**Migration path: Cloudflare R2.** When multi-replica or edge serving is needed, migrate to R2 — S3-compatible, zero egress fees, and already on Cloudflare for DNS. The `api` crate would read tiles from R2 on cache miss, or redirect to a signed URL.

### CDN — Cloudflare (Day One)

Put Cloudflare in front of the tile serving endpoint from the start. You're already on Cloudflare for DNS, tiles are immutable, and the cache headers (`max-age=31536000, immutable`) mean after the first request per tile, Railway never sees it again. This dramatically reduces compute costs and is effectively free.

### Future Optimization: PMTiles

Individual files on disk are the right MVP choice. If the thousands-of-small-files problem becomes painful on volumes, consider [PMTiles](https://github.com/protomaps/PMTiles) — a single-file archive format designed for HTTP range request serving. Eliminates the directory tree entirely. Not needed at launch, but worth watching.

### Free vs Pro

| Feature | Free | Pro |
|---|---|---|
| Client-side WASM processing | Yes | Yes |
| Download ZIP | Yes | Yes |
| Server-side processing | No | Yes |
| Hosted tile URL | No | Yes |
| Max image size (server) | — | 500 MB |
| Tile set storage | — | 5 GB |
| Public tile sets | — | Yes |

### Tasks

- [ ] Worker: extract tiles from ZIP to volume/S3 directory structure
- [ ] API: `GET /tiles/:user/:slug/:z/:x/:y.png` with caching headers
- [ ] Tile set detail page with embeddable Leaflet preview
- [ ] Copy-paste tile URL template for users (e.g., `https://tileforge.sandybridge.io/tiles/user/my-map/{z}/{x}/{y}.png`)
- [ ] Access control: private tile sets require auth
- [ ] Storage quota tracking per user
- [ ] Cleanup: delete tiles from storage when tile set is deleted

---

## Phase 5: Auth + Billing

### Goal

GitHub OAuth for identity, Stripe for billing. Gate server-side features behind a paid plan.

### Auth — GitHub OAuth

- NextAuth.js (Auth.js) with GitHub provider
- On first login, create `users` row with `github_id`, `username`, `avatar_url`
- Session stored as a signed JWT cookie (stateless, no session table)
- API routes and Rust API both validate the same JWT

> **Important: JWE vs JWS.** Auth.js defaults to encrypted JWTs (JWE), which the Rust API
> cannot decrypt without sharing the full encryption key and reimplementing the decryption
> logic. Configure Auth.js to use **signed JWTs (JWS)** with a shared HMAC secret (`HS256`)
> or an asymmetric keypair (`RS256`/`ES256`). HS256 with a shared `JWT_SECRET` env var is
> the simplest path — both Next.js and Rust (`jsonwebtoken` crate) can verify the same token.
> Ensure both services agree on the claims structure (`sub`, `iat`, `exp`, `plan`).

### Billing — Stripe

- Stripe Checkout for subscription creation
- Two plans: Free (default) and Pro ($X/mo)
- Stripe webhooks → Next.js API route → update `users.plan`

### Webhook Events

| Event | Action |
|---|---|
| `checkout.session.completed` | Set `plan = 'pro'`, store `stripe_customer_id` |
| `customer.subscription.deleted` | Set `plan = 'free'` |
| `customer.subscription.updated` | Update plan if changed |
| `invoice.payment_failed` | Optional: notify user, grace period |

### Middleware / Guards

- Next.js middleware: redirect unauthenticated users from dashboard routes
- API routes: check session, reject if not authenticated
- Rust API: validate JWT from `Authorization: Bearer <token>` header
- Pro-only endpoints return `403` with upgrade prompt for free users

### API Routes

```
GET  /api/auth/[...nextauth]   — Auth.js catch-all
POST /api/billing/checkout     — create Stripe Checkout session, redirect
POST /api/billing/portal       — create Stripe billing portal session
POST /api/billing/webhook      — Stripe webhook handler
GET  /api/user                 — current user profile + plan
```

### Tasks

- [ ] Install and configure Auth.js with GitHub provider
- [ ] Login/logout UI (header avatar, dropdown)
- [ ] Create user row on first login
- [ ] Stripe product + price setup
- [ ] `POST /api/billing/checkout` — create checkout session
- [ ] `POST /api/billing/webhook` — handle subscription events
- [ ] Middleware: protect dashboard and API routes
- [ ] Rust API: JWT validation for incoming requests
- [ ] Upgrade prompt in UI when free user hits a paid feature
- [ ] `POST /api/billing/portal` — self-service billing management

---

## Phase Summary + Dependencies

```
Phase 1: Rust API Service
  └─ no dependencies, can start immediately

Phase 2: Redis Job Queue + Worker
  └─ depends on Phase 1 (api crate exists)

Phase 3: PostgreSQL
  └─ no hard dependency, but useful after Phase 2

Phase 4: Tile Server
  └─ depends on Phase 2 (worker writes tiles) + Phase 3 (metadata)

Phase 5: Auth + Billing
  └─ depends on Phase 3 (users table)
  └─ gates Phase 1/2/4 features behind paid plan
```

Recommended build order: **1 → 2 → 3 → 5 → 4**

Build auth and billing (5) before the tile server (4) so hosted tiles launch behind the paywall from day one.

---

## Railway Service Configuration

### `railway.toml` (api)

```toml
[build]
builder = "dockerfile"
dockerfilePath = "crates/api/Dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 5
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

### `railway.toml` (worker)

```toml
[build]
builder = "dockerfile"
dockerfilePath = "crates/worker/Dockerfile"

[deploy]
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 5
```

### Environment Variables

| Variable | Service | Description |
|---|---|---|
| `PORT` | api | HTTP port (Railway sets this) |
| `DATABASE_URL` | api, web | Postgres connection string |
| `REDIS_URL` | api, worker | Redis connection string |
| `STORAGE_PATH` | api, worker | Volume mount path (`/data`) |
| `MAX_UPLOAD_BYTES` | api | Max image upload size |
| `JWT_SECRET` | api, web | Shared secret for JWT validation |
| `GITHUB_CLIENT_ID` | web | GitHub OAuth app ID |
| `GITHUB_CLIENT_SECRET` | web | GitHub OAuth app secret |
| `STRIPE_SECRET_KEY` | web | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | web | Stripe webhook signing secret |
| `NEXT_PUBLIC_API_URL` | web | Public URL of api service (for client-side calls) |

---

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | S3 vs Railway Volumes | **Volumes at launch.** Single replica is fine. Migrate to Cloudflare R2 (zero egress, S3-compatible) when multi-replica is needed. Storage path abstracted behind `STORAGE_PATH`. |
| 2 | Tile storage format | **Individual files on disk.** Simplest for HTTP serving. PMTiles as future optimization if small-file overhead becomes painful. |
| 3 | CDN | **Cloudflare on day one.** Already on CF for DNS, tiles are immutable, cache headers mean near-zero origin traffic after warmup. |
| 4 | JWT strategy | **Auth.js configured for signed JWTs (JWS, HS256)** with shared `JWT_SECRET`. NOT the default JWE. Both Next.js and Rust `jsonwebtoken` crate verify the same token. |
| 5 | Async threshold | **Dimension-based**, not file size. Reuse `STREAMING_THRESHOLD` logic (`w * h * 4 > 256MB`). A small JPEG can decode to a huge bitmap. |
| 6 | Stale job detection | **Timestamp-based.** `last_updated` in progress JSON; SSE endpoint returns `failed` if no progress update for 5 minutes. Simple MVP approach — no need for `BRPOPLPUSH` recovery queue yet. |

## Open Questions

1. **Rate limiting** — How aggressive? Per-user or per-IP? Token bucket in Redis?
2. **Pro pricing** — Need to determine based on compute + storage costs on Railway.
3. **Storage quotas** — 5GB per Pro user is a starting point. Need telemetry on actual tile set sizes to refine.
