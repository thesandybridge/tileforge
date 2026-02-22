# Stage 1: Build WASM
FROM rust:1.88-slim AS wasm-builder
RUN rustup target add wasm32-unknown-unknown
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/core/Cargo.toml crates/core/Cargo.toml
COPY crates/wasm/Cargo.toml crates/wasm/Cargo.toml
# Dummy workspace members so cargo resolves
COPY crates/api/Cargo.toml crates/api/Cargo.toml
COPY crates/worker/Cargo.toml crates/worker/Cargo.toml
COPY cli/Cargo.toml cli/Cargo.toml
COPY xtask/Cargo.toml xtask/Cargo.toml

RUN mkdir -p crates/core/src && echo "" > crates/core/src/lib.rs \
    && mkdir -p crates/wasm/src && echo "" > crates/wasm/src/lib.rs \
    && mkdir -p crates/api/src && echo "fn main() {}" > crates/api/src/main.rs \
    && mkdir -p crates/worker/src && echo "fn main() {}" > crates/worker/src/main.rs \
    && mkdir -p cli/src && echo "fn main() {}" > cli/src/main.rs \
    && mkdir -p xtask/src && echo "fn main() {}" > xtask/src/main.rs

# Build deps only
RUN cargo build --release --package tileforge-wasm --target wasm32-unknown-unknown 2>/dev/null || true

# Copy real source
COPY crates/core/ crates/core/
COPY crates/wasm/ crates/wasm/
RUN touch crates/core/src/lib.rs crates/wasm/src/lib.rs

RUN wasm-pack build crates/wasm --target no-modules --out-dir /wasm-out --release

# Stage 2: Build Next.js
FROM node:22-alpine AS builder
WORKDIR /app

COPY web/package.json web/package-lock.json web/.npmrc ./
RUN --mount=type=secret,id=NPM_TOKEN \
    NPM_TOKEN=$(cat /run/secrets/NPM_TOKEN) npm ci

COPY web/ .
COPY --from=wasm-builder /wasm-out ./public/wasm/

RUN npm run build

# Stage 3: Runtime
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["npm", "start"]
