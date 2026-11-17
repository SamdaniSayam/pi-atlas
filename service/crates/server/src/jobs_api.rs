//! Generic job plumbing: cache lookup, spawn_blocking execution, status
//! resolution, plus get/cancel/delete endpoints.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

use pi_core::exact::ScanControl;
use std::sync::Arc;
use std::time::Instant;

use crate::api::{AppState, ApiError};
use crate::jobs::JobStatus;

/// How many queued (not-yet-running) searches we tolerate before answering 429.
pub const MAX_QUEUED_JOBS: u64 = 16;

/// Cache-check wrapper around the four create handlers: returns `Some(response)`
/// on a cache hit so the caller can skip spawning.
pub async fn cached_response(state: &Arc<AppState>, cache_key: &str) -> Option<Response> {
    let hit = state.cache.lock().await.get(cache_key);
    hit.map(|result| {
        (
            StatusCode::OK,
            Json(serde_json::json!({ "cached": true, "result": result })),
        )
            .into_response()
    })
}

/// Spawn a blocking scan job with permit + deadline + cancel wiring.
/// The work closure must return the full result JSON (with an "incomplete" key).
pub fn spawn_job(
    state: &Arc<AppState>,
    kind: &str,
    cache_key: String,
    work: impl FnOnce(ScanControl<'_>, &pi_core::Dataset) -> serde_json::Value + Send + 'static,
) -> Result<Response, Response> {
    if state.jobs.active_count() >= MAX_QUEUED_JOBS {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({
                "error": { "code": "throttled", "message": "too many queued searches; cancel some and retry" }
            })),
        )
            .into_response());
    }
    let job = state.jobs.create(kind);
    let id = job.id;
    let state2 = Arc::clone(state);
    tokio::task::spawn_blocking(move || {
        let _permit = state2.permits.blocking_acquire().expect("semaphore closed");
        let ds = Arc::clone(&state2.dataset);
        let deadline = Instant::now() + state2.deadline;

        let job_cancel = job.clone();
        let job_progress = job.clone();
        let progress = move |checked: u64, total: u64| {
            *job_progress.progress.lock().unwrap() = Some((checked, total));
        };
        let cancel_fn = move || job_cancel.is_cancelled();

        let result = work(
            ScanControl {
                is_cancelled: &cancel_fn,
                deadline: Some(deadline),
                on_progress: Some(&progress),
            },
            &ds,
        );

        let cancelled = job.is_cancelled();
        let deadline_hit = Instant::now() >= deadline;
        let incomplete = result.get("incomplete").and_then(|v| v.as_bool()).unwrap_or(false);
        let status = if cancelled {
            JobStatus::Cancelled
        } else if incomplete && deadline_hit {
            JobStatus::Timeout
        } else {
            JobStatus::Done
        };
        if status == JobStatus::Done {
            state2.cache.blocking_lock().insert(cache_key, result.clone());
        }
        job.finish(status, Some(result), None);
    });
    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "job_id": id, "kind": kind })),
    )
        .into_response())
}

pub async fn get_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    match state.jobs.get(id) {
        Some(job) => Ok(Json(job.snapshot())),
        None => Err(ApiError::not_found(format!("no such job: {id}"))),
    }
}

pub async fn cancel_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    match state.jobs.get(id) {
        Some(job) => {
            job.cancel.store(true, std::sync::atomic::Ordering::Relaxed);
            Ok(Json(job.snapshot()))
        }
        None => Err(ApiError::not_found(format!("no such job: {id}"))),
    }
}

pub async fn delete_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if state.jobs.remove(id) {
        Ok(Json(serde_json::json!({ "ok": true })))
    } else {
        Err(ApiError::not_found(format!("no such job: {id}")))
    }
}
