# Build stage
FROM rust:1.88-slim AS builder
WORKDIR /app

# Copy manifests first for dep layer caching
COPY Cargo.toml Cargo.lock ./
COPY crates/core/Cargo.toml crates/core/Cargo.toml
COPY crates/api/Cargo.toml crates/api/Cargo.toml
COPY crates/worker/Cargo.toml crates/worker/Cargo.toml
COPY crates/wasm/Cargo.toml crates/wasm/Cargo.toml
COPY cli/Cargo.toml cli/Cargo.toml

# Dummy sources so cargo can resolve the workspace
RUN mkdir -p crates/core/src && echo "" > crates/core/src/lib.rs \
    && mkdir -p crates/api/src && echo "fn main() {}" > crates/api/src/main.rs \
    && mkdir -p crates/worker/src && echo "fn main() {}" > crates/worker/src/main.rs \
    && mkdir -p crates/wasm/src && echo "" > crates/wasm/src/lib.rs \
    && mkdir -p cli/src && echo "fn main() {}" > cli/src/main.rs

# Build deps only (cached unless Cargo.toml changes)
RUN cargo build --release --package tileforge-worker 2>/dev/null || true

# Copy real source for core + worker only
COPY crates/core/ crates/core/
COPY crates/worker/ crates/worker/

# Touch to invalidate cached build artifacts for our crates
RUN touch crates/core/src/lib.rs crates/worker/src/main.rs

RUN cargo build --release --package tileforge-worker

# Runtime stage
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/tileforge-worker /usr/local/bin/tileforge-worker

CMD ["tileforge-worker"]
