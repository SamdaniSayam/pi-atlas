# Multi-stage build: compile the Rust search service, ship a small runtime image.
# The dataset is NOT baked into the image — mount it read-only at /data.
FROM rust:1-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release --locked -p pi-server

FROM debian:bookworm-slim
# CA bundle from the builder (no apt network dependency at image build time).
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=builder /app/target/release/pi-server /usr/local/bin/pi-server

ENV PI_ATLAS_ADDR=0.0.0.0:7787 \
    PI_ATLAS_DATA=/data/pi-atlas-1b
EXPOSE 7787

ENTRYPOINT ["/usr/local/bin/pi-server"]
