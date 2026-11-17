//! Read-only endpoints: health, manifest, digit windows, samples, stats.

use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use std::sync::Arc;

use crate::api::{AppState, ApiError, MAX_SAMPLES, MAX_WINDOW_DIGITS};
use pi_core::exact::ScanControl;
use pi_core::stats::compute_stats;
use pi_core::window::window_1based;

#[derive(Deserialize)]
pub struct WindowQuery {
    pub start: u64,
    pub end: u64,
}

pub async fn health(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "pi-server",
        "format": pi_core::manifest::FORMAT_ID,
        "total_digits": state.dataset.total_digits(),
        "uptime_secs": state.started.elapsed().as_secs_f64(),
    }))
}

pub async fn manifest(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let m = &state.dataset.manifest;
    Json(serde_json::json!({
        "format": m.format,
        "total_digits": m.total_digits,
        "chunk_digits": m.chunk_digits,
        "chunk_count": m.chunks.len(),
        "first_digits": m.first_digits,
        "checkpoints": m.checkpoints,
        "sha256_packed": m.sha256_packed,
    }))
}

pub async fn window(
    State(state): State<Arc<AppState>>,
    Query(q): Query<WindowQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if q.start == 0 || q.end < q.start {
        return Err(ApiError::bad_request(
            "invalid_query",
            format!("window requires 1 <= start <= end; got start={} end={}", q.start, q.end),
        ));
    }
    if q.end - q.start + 1 > MAX_WINDOW_DIGITS {
        return Err(ApiError::bad_request(
            "too_large",
            format!("window may request at most {MAX_WINDOW_DIGITS} digits"),
        ));
    }
    // Clamp the tail at the dataset end so fixed-size client buckets never error.
    let total = state.dataset.total_digits();
    if q.start > total {
        return Ok(Json(serde_json::json!({
            "first_position": q.start,
            "digits": "",
        })));
    }
    let end = q.end.min(total);
    let digits = window_1based(&state.dataset, q.start, end)
        .map_err(|e| ApiError::bad_request("invalid_query", e.to_string()))?;
    Ok(Json(serde_json::json!({
        "first_position": q.start,
        "digits": String::from_utf8(digits).unwrap_or_default(),
    })))
}

#[derive(Deserialize)]
pub struct SamplesQuery {
    pub count: u64,
}

pub async fn samples(
    State(state): State<Arc<AppState>>,
    Query(q): Query<SamplesQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if q.count == 0 || q.count > MAX_SAMPLES {
        return Err(ApiError::bad_request(
            "invalid_query",
            format!("count must be 1..={MAX_SAMPLES}"),
        ));
    }
    let total = state.dataset.total_digits();
    let mut samples = Vec::with_capacity(q.count as usize);
    for i in 0..q.count {
        // Middle of each equal-width bucket: position is representative, digit stable.
        let bucket = total / q.count;
        let pos = (i * bucket) + bucket / 2 + 1;
        let pos = pos.min(total);
        samples.push(serde_json::json!({ "position": pos, "digit": state.dataset.digit(pos - 1) }));
    }
    Ok(Json(serde_json::json!({ "total_digits": total, "samples": samples })))
}

pub async fn stats(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let stats = state.stats.get_or_init(|| {
        // One-time full pass; the dataset is immutable so caching is sound.
        Arc::new(compute_stats(&state.dataset, Some(&ScanControl::default())).expect("stats pass"))
    });
    Json(serde_json::json!({
        "counts": stats.counts,
        "total_digits": stats.total_digits,
        "chi_square": stats.chi_square,
    }))
}
