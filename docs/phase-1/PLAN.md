# Phase 1: Rust API Service

## Context

TileForge currently processes all tiles client-side via WASM in a Web Worker. Phase 1 adds a standalone Rust HTTP API service (axum) that reuses `crates/core` for server-side processing — faster, supports larger images, full threading. This is the foundation for the async job queue (Phase 2) and paid tile hosting (Phase 4).

## Files to Create

### 1. `crates/api/Cargo.toml`

New crate added to workspace. Dependencies: `axum` (0.8, multipart feature), `tokio` (full), `tower-http` (cors + trace), `serde`, `serde_json`, `tracing`, `tracing-subscriber`, and `tileforge-core` (path dep).

### 2. `crates/api/src/main.rs`

Single-file axum server (~200 lines). Contains:

- **`AppState`** — `max_upload_bytes: usize`, shared via `axum::extract::State`
- **`AppConfig`** — reads `PORT` (default 8080) and `MAX_UPLOAD_BYTES` (default 100MB) from env
- **`ApiError`** — enum with `MissingImage`, `ImageTooLarge`, `InvalidField`, `Processing` variants. Implements `IntoResponse` returning `{ "error": "..." }` JSON with appropriate status codes (400/413/500)
- **`GET /health`** — returns 200 `"ok"`
- **`POST /api/tiles`** — multipart handler:
  - Extracts `image` (bytes), `tile_size`, `min_zoom`, `max_zoom`, `projection` fields
  - Validates upload size against `MAX_UPLOAD_BYTES`
  - Offloads to `tokio::task::spawn_blocking` (process_bytes is sync/CPU-heavy)
  - Uses `Cursor<Vec<u8>>` as writer (same pattern as WASM crate)
  - Returns ZIP with `content-type: application/zip` + `content-disposition` headers
  - Progress callback is a no-op (SSE progress is Phase 2)
- **`main()`** — tracing init, CORS layer (permissive for local dev), TraceLayer, bind to `0.0.0.0:PORT`

### 3. `crates/api/Dockerfile`

Multi-stage build. Context is workspace root (needs `crates/core`).

- **Build stage** (`rust:1.85-slim`): Copy manifests + dummy sources first for dep layer caching, then copy real source, `cargo build --release --package tileforge-api`
- **Runtime stage** (`debian:bookworm-slim`): Copy binary, expose 8080, `CMD ["tileforge-api"]`

### 4. `web/app/api/process/route.ts`

Next.js App Router route handler. Proxies multipart requests to the Rust API:

- Reads `API_URL` from env (default `http://localhost:8080`, production: `http://api.railway.internal:8080`)
- Forwards `request.body` as a stream with `duplex: "half"` (no buffering in Next.js)
- Forwards error responses from Rust API as-is
- Returns 502 on connection failure (API unreachable)

## Files to Modify

### 5. `Cargo.toml` (workspace root)

Add `"crates/api"` to `members` list.

### 6. `web/lib/use-tileforge.ts`

Add `processServer()` alongside existing `process()`:

- Same signature: `(imageBytes: ArrayBuffer, opts?) => void`
- Async — builds `FormData`, POSTs to `/api/process`, awaits response
- Drives the same state machine: sets `status` to `"processing"` → `"done"` / `"error"`
- Sets `progress` to `null` (no granular progress in Phase 1 — UI already handles this with "Starting..." text)
- On success: wraps response `ArrayBuffer` in a `Blob`, sets `zipBlob` and `durationMs`
- On failure: parses `{ "error": "..." }` from response, sets `error` state
- Added to hook return value: `{ ..., processServer, ... }`

### 7. `web/app/page.tsx`

- Add `useServer` state (`useState(false)`)
- Add "Mode" select dropdown (Local WASM / Server) in the config grid — extend to 4 columns
- Update `onProcess` to dispatch: `useServer ? processServer(copy, opts) : process(copy, opts)`
- Update `canProcess` logic: server path doesn't require WASM to be ready
- Update `showCard` to show the card when `useServer` is true even if WASM is still loading

## Implementation Order

1. `Cargo.toml` — add workspace member
2. `crates/api/Cargo.toml` — crate manifest
3. `crates/api/src/main.rs` — axum server
4. Verify: `cargo run --package tileforge-api` + curl test
5. `crates/api/Dockerfile` — build and test with `docker build`
6. `web/app/api/process/route.ts` — proxy route
7. `web/lib/use-tileforge.ts` — add `processServer()`
8. `web/app/page.tsx` — UI toggle
9. End-to-end test through the web UI

## Railway Deployment

The API is a **separate Railway service** from the web app (same repo, different service). Configure in the Railway dashboard:
- New service → point to repo → set Dockerfile path to `crates/api/Dockerfile` with build context at repo root
- Set env vars: `PORT` (auto), `MAX_UPLOAD_BYTES`
- Health check: `GET /health`
- On the web service, add env var: `API_URL=http://api.railway.internal:8080`

No `railway.toml` at root — that could conflict with the existing web service's Nixpacks auto-detection. Railway service config lives in the dashboard.

## Verification

1. **Rust API standalone**: `cargo run --package tileforge-api` then:
   - `curl localhost:8080/health` → `ok`
   - `curl -X POST localhost:8080/api/tiles -F "image=@test.png" -F "tile_size=256" -F "max_zoom=2" -o tiles.zip` → valid ZIP
   - `curl -X POST localhost:8080/api/tiles` (no image) → 400
2. **Docker**: `docker build -f crates/api/Dockerfile -t tileforge-api .` from workspace root
3. **Next.js proxy**: `npm run dev` (web) + `cargo run --package tileforge-api` → POST to `/api/process` via browser
4. **UI end-to-end**: Select "Server" mode, upload image, process, verify download + tile preview work identically to WASM path
