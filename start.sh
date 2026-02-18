#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[tileforge]${NC} $*"; }
warn() { echo -e "${YELLOW}[tileforge]${NC} $*"; }
err()  { echo -e "${RED}[tileforge]${NC} $*" >&2; }

# Collect background PIDs for cleanup
PIDS=()
cleanup() {
    echo
    log "Shutting down..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    log "Done."
}
trap cleanup EXIT INT TERM

# ── Preflight checks ───────────────────────────────────────────────
check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        err "Required command not found: $1"
        exit 1
    fi
}

check_cmd docker
check_cmd cargo
check_cmd node
check_cmd npm

# ── Load env files ─────────────────────────────────────────────────
if [[ ! -f .env ]]; then
    err "Missing .env — see README for required variables"
    exit 1
fi

if [[ ! -f web/.env.local ]]; then
    err "Missing web/.env.local — see README for required variables"
    exit 1
fi

# Export root .env so Rust processes pick it up
set -a
source .env
set +a

# ── 1. Start infrastructure ───────────────────────────────────────
log "Starting Docker services (Postgres, Redis, MinIO)..."
docker compose up -d

# Wait for Postgres
log "Waiting for Postgres..."
until docker compose exec -T postgres pg_isready -U tileforge &>/dev/null; do
    sleep 1
done
log "Postgres ready."

# Wait for Redis
log "Waiting for Redis..."
until docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; do
    sleep 1
done
log "Redis ready."

# Wait for MinIO
log "Waiting for MinIO..."
until curl -sf http://localhost:9000/minio/health/live &>/dev/null; do
    sleep 1
done
log "MinIO ready."

# ── 2. Install web deps if needed ─────────────────────────────────
if [[ ! -d web/node_modules ]]; then
    log "Installing web dependencies..."
    (cd web && npm install)
fi

# ── 3. Launch services ────────────────────────────────────────────
log "Starting Rust API..."
cargo run --release --package tileforge-api &
PIDS+=($!)

log "Starting Worker..."
cargo run --release --package tileforge-worker &
PIDS+=($!)

# Stripe webhook forwarding (optional — skip if stripe CLI not installed)
if command -v stripe &>/dev/null; then
    log "Starting Stripe webhook forwarding..."
    stripe listen --forward-to localhost:3000/api/stripe/webhook &
    PIDS+=($!)
else
    warn "Stripe CLI not found — skipping webhook forwarding"
fi

log "Starting Next.js dev server..."
(cd web && npm run dev) &
PIDS+=($!)

echo
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo -e "${CYAN}  TileForge is starting up!${NC}"
echo -e "${CYAN}  Web:   http://localhost:3000${NC}"
echo -e "${CYAN}  API:   http://localhost:8080${NC}"
echo -e "${CYAN}  MinIO: http://localhost:9001${NC}"
echo -e "${CYAN}  Press Ctrl+C to stop all services${NC}"
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo

wait
