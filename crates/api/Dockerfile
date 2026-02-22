# Build stage
FROM rust:1.88-slim AS builder
WORKDIR /app

# Copy manifests first for dep layer caching
COPY Cargo.toml Cargo.lock ./
COPY crates/core/Cargo.toml crates/core/Cargo.toml
COPY crates/shared/Cargo.toml crates/shared/Cargo.toml
COPY crates/api/Cargo.toml crates/api/Cargo.toml
COPY crates/worker/Cargo.toml crates/worker/Cargo.toml
COPY crates/wasm/Cargo.toml crates/wasm/Cargo.toml
COPY cli/Cargo.toml cli/Cargo.toml
COPY xtask/Cargo.toml xtask/Cargo.toml

# Dummy sources so cargo can resolve the workspace
RUN mkdir -p crates/core/src && echo "" > crates/core/src/lib.rs \
    && mkdir -p crates/shared/src && echo "" > crates/shared/src/lib.rs \
    && mkdir -p crates/api/src && echo "fn main() {}" > crates/api/src/main.rs \
    && mkdir -p crates/worker/src && echo "fn main() {}" > crates/worker/src/main.rs \
    && mkdir -p crates/wasm/src && echo "" > crates/wasm/src/lib.rs \
    && mkdir -p cli/src && echo "fn main() {}" > cli/src/main.rs \
    && mkdir -p xtask/src && echo "fn main() {}" > xtask/src/main.rs

# Build deps only (cached unless Cargo.toml changes)
RUN cargo build --release --package tileforge-api 2>/dev/null || true

# Copy real source for core + shared + api
COPY crates/core/ crates/core/
COPY crates/shared/ crates/shared/
COPY crates/api/ crates/api/

# Touch to invalidate cached build artifacts for our crates
RUN touch crates/core/src/lib.rs crates/shared/src/lib.rs crates/api/src/main.rs

RUN cargo build --release --package tileforge-api

# Runtime stage
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/tileforge-api /usr/local/bin/tileforge-api

EXPOSE 8080
CMD ["tileforge-api"]
