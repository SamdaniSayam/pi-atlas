//! Route wiring, shared state, and the JSON error contract.

use std::sync::Arc;
use std::time::Duration;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::Json;
use axum::Router;
use pi_core::Dataset;
use tokio::sync::{Mutex, Semaphore};

use crate::cache::TtlCache;
use crate::jobs::JobRegistry;

pub type StatsCache = std::sync::OnceLock<Arc<pi_core::stats::DigitStats>>;

pub const MAX_POSITION_CAP: usize = 200_000;
pub const MAX_WINDOW_DIGITS: u64 = 10_000;
pub const MAX_SAMPLES: u64 = 4096;
pub const DEFAULT_POSITION_CAP: usize = 200_000;
pub const DATE_POSITION_CAP: usize = 10_000;
pub const MAX_PATTERN_ROWS: usize = 6;
pub const MAX_PATTERN_COLS: usize = 6;
pub const MAX_PATTERN_CELLS_COLOUR: usize = 8;
pub const MAX_PATTERN_CELLS_SHAPE: usize = 24;
pub const MAX_FIELD_COLS: u64 = 96;

pub struct AppState {
    pub dataset: Arc<Dataset>,
    pub jobs: JobRegistry,
    pub permits: Arc<Semaphore>,
    pub deadline: Duration,
    pub cache: Mutex<TtlCache>,
    pub stats: StatsCache,
    pub static_dir: Option<std::path::PathBuf>,
    pub started: std::time::Instant,
}

/// `{ "error": { "code": "...", "message": "..." } }`
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: String) -> Self {
        ApiError { status, code, message }
    }
    pub fn bad_request(code: &'static str, message: String) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message)
    }
    pub fn not_found(message: String) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = serde_json::json!({ "error": { "code": self.code, "message": self.message } });
        (self.status, Json(body)).into_response()
    }
}

pub fn build_router(state: Arc<AppState>) -> Router {
    let api = Router::new()
        .route("/health", get(crate::handlers::health))
        .route("/manifest", get(crate::handlers::manifest))
        .route("/window", get(crate::handlers::window))
        .route("/samples", get(crate::handlers::samples))
        .route("/stats", get(crate::handlers::stats))
        .route("/jobs/exact", post(crate::jobs_create::create_exact))
        .route("/jobs/letters", post(crate::jobs_create::create_letters))
        .route("/jobs/dates", post(crate::jobs_create::create_dates))
        .route("/jobs/pattern", post(crate::jobs_create::create_pattern))
        .route("/jobs/{id}", get(crate::jobs_api::get_job))
        .route("/jobs/{id}/cancel", post(crate::jobs_api::cancel_job))
        .route("/jobs/{id}", delete(crate::jobs_api::delete_job))
        .with_state(state);

    Router::new().nest("/api/v1", api)
}
