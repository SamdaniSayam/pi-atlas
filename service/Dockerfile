# Multi-stage build: compile the Rust search service, ship a small runtime image.
# The dataset is NOT baked into the image — mount it read-only at /data.
FROM rust:1-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release --locked -p pi-server

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/pi-server /usr/local/bin/pi-server

ENV PI_ATLAS_ADDR=0.0.0.0:7787 \
    PI_ATLAS_DATA=/data/pi-atlas-1b
EXPOSE 7787

ENTRYPOINT ["/usr/local/bin/pi-server"]
