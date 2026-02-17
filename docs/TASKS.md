# TileForge — Task Tracker

> This file maintains implementation state across sessions. Update after completing each task.

## Current Phase: 1 — Rust API Service

See: [Phase 1 Plan](phase-1/PLAN.md) | [TDD](TDD.md)

### Phase 1 Tasks

| # | Task | Status | Notes |
|---|---|---|---|
| 1.1 | Add `crates/api` to workspace `Cargo.toml` | done | |
| 1.2 | Create `crates/api/Cargo.toml` | done | axum 0.8, tokio, tower-http, tileforge-core |
| 1.3 | Create `crates/api/src/main.rs` | done | Raw body + query params (not multipart) |
| 1.4 | Verify Rust API compiles | done | `cargo check` + curl tests pass |
| 1.5 | Create `crates/api/Dockerfile` | done | Multi-stage, all workspace members stubbed |
| 1.6 | Next.js → Rust API proxy | done | Rewrites in next.config.ts (not route handler) |
| 1.7 | Add `processServer()` to `use-tileforge.ts` | done | Raw bytes POST to `/api/tiles?params` |
| 1.8 | Add server/local toggle to `page.tsx` | done | Mode select, spinner for server, no zoom caps |
| 1.9 | End-to-end test | done | Both paths verified through web UI |

### Key Decisions (Phase 1)

- **No multipart** — API accepts raw image bytes as POST body, config via query params. Avoids Next.js multipart proxy issues.
- **Next.js rewrites** (not route handler) — `next.config.ts` rewrites `/api/tiles` → Rust API. Simpler, no body buffering code.
- **`proxyClientMaxBodySize: "500mb"`** — Next.js experimental config to support large image uploads through the rewrite proxy.
- **No SSE progress for server path** — UI shows spinner with "Processing on server..." text.
- **No max zoom cap in server mode** — server has more resources; zoom levels 0-12 available.
- `process_bytes` offloaded to `spawn_blocking` — sync/CPU-heavy, can't block tokio runtime.
- In-memory ZIP via `Cursor<Vec<u8>>` — streaming to disk is Phase 2.
- `API_URL` env var: `http://localhost:8080` (dev), `http://api.railway.internal:8080` (prod).

---

## Overall Roadmap

| Phase | Name | Status | Depends On |
|---|---|---|---|
| 1 | Rust API Service | **done** | — |
| 2 | Redis Job Queue + Worker | pending | Phase 1 |
| 3 | PostgreSQL (users, tile sets) | pending | — |
| 4 | Tile Server (hosted tiles) | pending | Phase 2, 3 |
| 5 | Auth + Billing | pending | Phase 3 |

Build order: **1 → 2 → 3 → 5 → 4**
