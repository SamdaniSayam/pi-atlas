//! The four search endpoints: exact numeric, letters, dates, 2-D pattern.
//! Validation mirrors the TS engines; odds/difficulty stay client-side.

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use std::sync::Arc;

use pi_core::exact::{longest_existing_prefix, search_exact};
use pi_core::letters::search_letters;
use pi_core::pattern::{search_pattern, PatternSpec};

use crate::api::{
    AppState, ApiError, MAX_PATTERN_COLS, MAX_PATTERN_ROWS, MAX_POSITION_CAP, MAX_FIELD_COLS,
    MAX_PATTERN_CELLS_COLOUR, MAX_PATTERN_CELLS_SHAPE, DEFAULT_POSITION_CAP, DATE_POSITION_CAP,
};
use crate::jobs_api::{cached_response, spawn_job};
use crate::normalize::{date_sequences, is_valid_date, normalize_word};

/// TS `sanitizeQuery`: separators silently dropped; digits kept; anything
/// else is reported. Caller turns an empty result into an error.
fn sanitize_digits(raw: &str) -> (String, String) {
    const SILENT: &[char] = &[',', ' ', '\u{a0}', '.', '_', '-', '\'', '\u{2019}', '\t'];
    let mut removed = String::new();
    let mut cleaned = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_digit() {
            cleaned.push(ch);
        } else if SILENT.contains(&ch) {
            // silently dropped
        } else {
            removed.push(ch);
        }
    }
    (cleaned, removed)
}

#[derive(Deserialize)]
pub struct ExactBody {
    pub query: String,
    pub position_cap: Option<usize>,
}

pub async fn create_exact(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ExactBody>,
) -> Result<Response, Response> {
    let (query, removed) = sanitize_digits(&body.query);
    if !removed.is_empty() {
        return Err(bad(format!("query contains non-digit characters: {removed}")));
    }
    if query.is_empty() {
        return Err(bad("query is empty after removing separators".into()));
    }
    if query.chars().count() > 20 {
        return Err(bad("query is longer than the 20-digit cap".into()));
    }
    let cap = body.position_cap.unwrap_or(DEFAULT_POSITION_CAP).min(MAX_POSITION_CAP);
    let key = format!("exact:{query}:{cap}");
    if let Some(hit) = cached_response(&state, &key).await {
        return Ok(hit);
    }

    spawn_job(&state, "exact", key, move |ctl, ds| {
        let bytes = query.as_bytes().to_vec();
        let cap = cap;
        let r = search_exact(ds, &bytes, cap, &ctl).expect("query pre-validated");
        let (longest, longest_pos) = if r.total == 0 && bytes.len() > 1 {
            longest_existing_prefix(ds, &bytes, &ctl)
                .ok()
                .flatten()
                .unwrap_or((0, 0))
        } else {
            (0, 0)
        };
        serde_json::json!({
            "query": query,
            "length": query.len(),
            "found": r.total > 0,
            "total": r.total,
            "positions": r.positions,
            "position_cap": cap,
            "truncated": r.truncated,
            "incomplete": r.incomplete,
            "longest_existing_prefix": longest,
            "longest_existing_prefix_position": longest_pos,
        })
    })
}

#[derive(Deserialize)]
pub struct LettersBody {
    pub word: String,
}

pub async fn create_letters(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LettersBody>,
) -> Result<Response, Response> {
    let (word, removed) = normalize_word(&body.word);
    if word.is_empty() {
        return Err(bad("word contains no letters".into()));
    }
    let key = format!("letters:{word}");
    if let Some(hit) = cached_response(&state, &key).await {
        return Ok(hit);
    }

    spawn_job(&state, "letters", key, move |ctl, ds| {
        let values: Vec<u8> = word.bytes().map(|b| b - b'A').collect();
        let word_len = word.len();
        let r = search_letters(ds, &word, &values, 200_000, &ctl);
        let frames: Vec<_> = r
            .frames
            .iter()
            .map(|f| {
                serde_json::json!({
                    "frame": f.frame,
                    "positions": f.positions,
                    "total": f.total,
                    "capped": f.capped,
                })
            })
            .collect();
        serde_json::json!({
            "word": word,
            "removed": removed,
            "pair_values": values,
            "frames": frames,
            "total": r.total,
            "incomplete": r.incomplete,
        })
    })
}

fn bad(message: String) -> Response {
    ApiError::bad_request("invalid_query", message).into_response()
}

#[derive(Deserialize)]
pub struct DatesBody {
    pub year: u32,
    pub month: u32,
    pub day: u32,
}

pub async fn create_dates(
    State(state): State<Arc<AppState>>,
    Json(body): Json<DatesBody>,
) -> Result<Response, Response> {
    let (y, m, d) = (body.year, body.month, body.day);
    if !is_valid_date(y, m, d) {
        return Err(bad(format!(
            "invalid date: {y}-{m:02}-{d:02} (must be a real calendar date, year 1..=9999)"
        )));
    }
    let key = format!("dates:{y}:{m}:{d}");
    if let Some(hit) = cached_response(&state, &key).await {
        return Ok(hit);
    }

    spawn_job(&state, "dates", key, move |ctl, ds| {
        let mut seen = std::collections::HashSet::new();
        let mut rows = Vec::new();
        for (id, label, sequence) in date_sequences(y, m, d) {
            if !seen.insert(sequence.clone()) {
                continue; // first format wins, like the TS engine
            }
            let bytes = sequence.as_bytes();
            let r = search_exact(ds, bytes, DATE_POSITION_CAP, &ctl).expect("sequence pre-validated");
            let (longest, longest_pos) = if r.total == 0 {
                longest_existing_prefix(ds, bytes, &ctl)
                    .ok()
                    .flatten()
                    .unwrap_or((0, 0))
            } else {
                (0, 0)
            };
            rows.push(serde_json::json!({
                "id": id,
                "label": label,
                "sequence": sequence,
                "result": {
                    "query": sequence,
                    "length": sequence.len(),
                    "found": r.total > 0,
                    "total": r.total,
                    "positions": r.positions,
                    "position_cap": DATE_POSITION_CAP,
                    "truncated": r.truncated,
                    "incomplete": r.incomplete,
                    "longest_existing_prefix": longest,
                    "longest_existing_prefix_position": longest_pos,
                },
            }));
        }
        // Found rows first, then by first position ascending.
        rows.sort_by(|a, b| {
            let fa = a["result"]["found"].as_bool().unwrap_or(false);
            let fb = b["result"]["found"].as_bool().unwrap_or(false);
            if fa != fb {
                return if fa { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
            }
            let pa = a["result"]["positions"][0].as_u64().unwrap_or(u64::MAX);
            let pb = b["result"]["positions"][0].as_u64().unwrap_or(u64::MAX);
            pa.cmp(&pb)
        });
        serde_json::json!({
            "input": { "year": y, "month": m, "day": d },
            "rows": rows,
            "incomplete": false,
        })
    })
}

#[derive(Deserialize)]
pub struct PatternBody {
    pub rows: usize,
    pub cols: usize,
    pub cells: Vec<i8>,
    pub colour_mode: bool,
    pub field_cols: u64,
    pub match_cap: Option<usize>,
}

pub async fn create_pattern(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PatternBody>,
) -> Result<Response, Response> {
    let (rows, cols) = (body.rows, body.cols);
    if !(1..=MAX_PATTERN_ROWS).contains(&rows) || !(1..=MAX_PATTERN_COLS).contains(&cols) {
        return Err(bad(format!(
            "pattern grid must be 1..={MAX_PATTERN_ROWS} rows x 1..={MAX_PATTERN_COLS} cols"
        )));
    }
    if body.cells.len() != rows * cols {
        return Err(bad(format!(
            "cells length {} does not match grid {rows}x{cols}",
            body.cells.len()
        )));
    }
    let cell_cap = if body.colour_mode { MAX_PATTERN_CELLS_COLOUR } else { MAX_PATTERN_CELLS_SHAPE };
    let value_cap: i8 = if body.colour_mode { 9 } else { 1 };
    let mut constrained = 0usize;
    for &v in &body.cells {
        if v == -1 {
            continue;
        }
        if v < 0 || v > value_cap {
            return Err(bad(format!(
                "cell value {v} out of range for {} mode",
                if body.colour_mode { "colour" } else { "shape" }
            )));
        }
        constrained += 1;
    }
    if constrained < 2 {
        return Err(bad("at least 2 constrained cells are required".into()));
    }
    if constrained > cell_cap {
        return Err(bad(format!("at most {cell_cap} constrained cells in this mode")));
    }
    if !(16..=MAX_FIELD_COLS).contains(&body.field_cols) || body.field_cols < cols as u64 {
        return Err(bad(format!("field_cols must be 16..={MAX_FIELD_COLS} and >= cols")));
    }
    let match_cap = body.match_cap.unwrap_or(200_000).min(200_000);

    let cells_key = body.cells.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(",");
    let key = format!(
        "pattern:{}:{}:{}:{}:{}:{}",
        rows, cols, body.colour_mode, cells_key, body.field_cols, match_cap
    );
    if let Some(hit) = cached_response(&state, &key).await {
        return Ok(hit);
    }

    spawn_job(&state, "pattern", key, move |ctl, ds| {
        let spec = PatternSpec { rows, cols, cells: body.cells.clone(), colour_mode: body.colour_mode };
        let r = search_pattern(ds, &spec, body.field_cols, match_cap, &ctl);
        serde_json::json!({
            "total": r.total,
            "matches": r.matches,
            "capped": r.capped,
            "incomplete": r.incomplete,
            "anchors": r.anchors,
            "constrained_cells": constrained,
            "field_cols": body.field_cols,
            "rows": rows,
            "cols": cols,
            "colour_mode": body.colour_mode,
        })
    })
}
