//! pi-server: HTTP API for the π Atlas search engine.
//!
//! Configuration (environment variables):
//!   PI_ATLAS_ADDR          listen address        (default 127.0.0.1:7777)
//!   PI_ATLAS_DATA          dataset directory     (required)
//!   PI_ATLAS_TIMEOUT_SECS  per-job deadline      (default 300)
//!   PI_ATLAS_MAX_CONCURRENT  concurrent scans    (default 4)
//!   PI_ATLAS_CACHE_ENTRIES resident cached results (default 256)
//!   PI_ATLAS_CACHE_TTL_SECS  cached result age   (default 600)
//!   PI_ATLAS_STATIC        optional SPA directory served at / (assets + index.html)
//!   PI_ATLAS_CORS_ORIGINS  comma-separated allowed origins for CORS.
//!                          Default: local development origins only.
//!                          "*" re-enables permissive CORS (development only;
//!                          never use in production).

use std::process::exit;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::http::{header, HeaderValue, Method};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing_subscriber::EnvFilter;

use pi_core::dataset::load_dataset;

mod api;
mod cache;
mod handlers;
mod jobs;
mod jobs_api;
mod jobs_create;
mod normalize;

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse::<T>().ok())
        .unwrap_or(default)
}

/// Origins allowed to call the API from a browser.
///
/// Defaults are the local development origins only. In production, set
/// PI_ATLAS_CORS_ORIGINS to the exact production frontend origin(s), e.g.
///   PI_ATLAS_CORS_ORIGINS=https://samdanisayam.github.io,https://pi-atlas.example.com
const DEFAULT_CORS_ORIGINS: &[&str] = &[
    "http://localhost:4174",
    "http://localhost:4175",
    "http://localhost:5173",
    "http://127.0.0.1:4174",
    "http://127.0.0.1:4175",
    "http://127.0.0.1:7787",
];

fn build_cors() -> CorsLayer {
    let raw = std::env::var("PI_ATLAS_CORS_ORIGINS").unwrap_or_default();
    let raw = raw.trim();
    if raw == "*" {
        tracing::warn!(
            "PI_ATLAS_CORS_ORIGINS=* — permissive CORS enabled (development only, never in production)"
        );
        return CorsLayer::permissive();
    }

    let origins: Vec<HeaderValue> = if raw.is_empty() {
        DEFAULT_CORS_ORIGINS
            .iter()
            .map(|o| {
                o.parse::<HeaderValue>()
                    .expect("hard-coded default CORS origin is invalid")
            })
            .collect()
    } else {
        raw.split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| {
                s.parse::<HeaderValue>().unwrap_or_else(|_| {
                    eprintln!("PI_ATLAS_CORS_ORIGINS contains an invalid origin: {s:?}");
                    exit(2);
                })
            })
            .collect()
    };

    if origins.is_empty() {
        eprintln!("PI_ATLAS_CORS_ORIGINS resolved to an empty allowlist; refusing to start");
        exit(2);
    }

    tracing::info!(
        "CORS allowlist: {}",
        origins
            .iter()
            .map(|o| o.to_str().unwrap_or("<invalid>"))
            .collect::<Vec<_>>()
            .join(", ")
    );

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE])
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let addr: String = env_or("PI_ATLAS_ADDR", "127.0.0.1:7777".to_string());
    let data_dir = match std::env::var("PI_ATLAS_DATA") {
        Ok(v) => v,
        Err(_) => {
            eprintln!("PI_ATLAS_DATA must point at a packed dataset directory (manifest.json + chunks/)");
            exit(2);
        }
    };
    let timeout_secs: u64 = env_or("PI_ATLAS_TIMEOUT_SECS", 300);
    let max_concurrent: usize = env_or("PI_ATLAS_MAX_CONCURRENT", 4);
    let cache_entries: usize = env_or("PI_ATLAS_CACHE_ENTRIES", 256);
    let cache_ttl_secs: u64 = env_or("PI_ATLAS_CACHE_TTL_SECS", 600);
    let static_dir = std::env::var("PI_ATLAS_STATIC").ok().filter(|v| !v.is_empty());

    tracing::info!("loading dataset from {data_dir}");
    let dataset = match load_dataset(std::path::Path::new(&data_dir)) {
        Ok(ds) => ds,
        Err(e) => {
            eprintln!("failed to load dataset from {data_dir}: {e}");
            exit(2);
        }
    };
    tracing::info!(
        "dataset ready: {} digits in {} chunks (first digits: {})",
        dataset.total_digits(),
        dataset.chunk_count(),
        dataset.manifest.first_digits
    );

    let state = Arc::new(api::AppState {
        dataset: Arc::new(dataset),
        jobs: jobs::JobRegistry::new(Duration::from_secs(300)),
        permits: Arc::new(tokio::sync::Semaphore::new(max_concurrent)),
        deadline: Duration::from_secs(timeout_secs),
        cache: tokio::sync::Mutex::new(cache::TtlCache::new(
            cache_entries,
            Duration::from_secs(cache_ttl_secs),
        )),
        stats: api::StatsCache::new(),
        static_dir: static_dir.map(Into::into),
        started: std::time::Instant::now(),
    });

    let mut app = api::build_router(Arc::clone(&state));

    // CORS allowlist (PI_ATLAS_CORS_ORIGINS). Requests with no Origin header
    // (e.g. curl, server-to-server) are not subject to CORS.
    app = app.layer(build_cors());

    // Cap request bodies: the JSON search requests are tiny; this stops
    // abuse before de/serialization work happens.
    app = app.layer(DefaultBodyLimit::max(64 * 1024));

    if let Some(dir) = &state.static_dir {
        use tower_http::services::{ServeDir, ServeFile};
        let index = std::path::Path::new(dir).join("index.html");
        let serve = ServeDir::new(dir).not_found_service(ServeFile::new(index));
        app = app.fallback_service(serve);
    }

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| {
            eprintln!("failed to bind {addr}: {e}");
            exit(2);
        });
    tracing::info!("pi-server listening on http://{addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap_or_else(|e| {
            eprintln!("server error: {e}");
            exit(1);
        });
}

/// Shut down cleanly on Ctrl-C or SIGTERM (systemd/Docker stop).
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sigterm) => {
                sigterm.recv().await;
            }
            Err(e) => {
                eprintln!("failed to install SIGTERM handler: {e}");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received; draining in-flight requests");
}
