FROM rust:bookworm AS builder

WORKDIR /usr/src/app

COPY Cargo.toml Cargo.lock ./
COPY crates/core/Cargo.toml ./crates/core/
COPY crates/worker/Cargo.toml ./crates/worker/
COPY src-tauri/Cargo.toml ./src-tauri/

RUN mkdir -p crates/core/src crates/worker/src src-tauri/src \
    && echo "" > crates/core/src/lib.rs \
    && echo "fn main() {}" > crates/worker/src/main.rs \
    && echo "" > src-tauri/src/lib.rs \
    && echo "fn main() {}" > src-tauri/src/main.rs \
    && echo "fn main() {}" > src-tauri/build.rs \
    && cargo build --release --bin vod-worker \
    && rm -rf crates/core/src crates/worker/src

COPY crates/core ./crates/core
COPY crates/worker ./crates/worker
RUN cargo build --release --bin vod-worker

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/src/app/target/release/vod-worker /usr/local/bin/vod-worker

VOLUME ["/data"]

ENV WORKER_PORT=8080
ENV DATA_DIR=/data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD ["vod-worker"]
