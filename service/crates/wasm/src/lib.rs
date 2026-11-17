//! Stage 3 prototype: wasm-bindgen facade over the *unchanged* `pi-core`
//! search algorithms. No search logic is reimplemented here; every function
//! delegates to the same Rust code the HTTP service uses, so results are
//! byte-for-byte comparable (Stage 5).
//!
//! The prototype constructs a `Dataset` from a manifest + packed bytes supplied
//! by JS. Stage 4 replaces whole-dataset residency with a chunk provider; the
//! facade API is intentionally kept narrow so that change stays internal.

use pi_core::exact::{find_first, longest_existing_prefix, search_exact, ScanControl};
use pi_core::letters::search_letters;
use pi_core::manifest::Manifest;
use pi_core::pattern::{search_pattern, PatternSpec};
use pi_core::stats::compute_stats;
use pi_core::window::window_1based;
use pi_core::Dataset;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

fn js_err<E: std::fmt::Display>(err: E) -> JsValue {
    JsValue::from_str(&err.to_string())
}

/// A checksum-verified dataset loaded into the WASM engine.
#[wasm_bindgen]
pub struct PiEngine {
    ds: Dataset,
}

#[wasm_bindgen]
impl PiEngine {
    /// Build an engine from a `pi-atlas-packed-v1` manifest JSON string and the
    /// concatenated packed chunk bytes. Manifest, per-chunk and whole-file
    /// checksums are verified before the engine is usable.
    #[wasm_bindgen(constructor)]
    pub fn new(manifest_json: &str, packed: &[u8]) -> Result<PiEngine, JsValue> {
        let manifest: Manifest = serde_json::from_str(manifest_json).map_err(js_err)?;
        manifest.validate().map_err(js_err)?;
        manifest.verify_packed(packed).map_err(js_err)?;

        let mut chunk_digit_starts = Vec::with_capacity(manifest.chunks.len());
        let mut acc = 0u64;
        for meta in &manifest.chunks {
            chunk_digit_starts.push(acc);
            acc += meta.digits;
        }
        Ok(PiEngine {
            ds: Dataset { manifest, packed: packed.to_vec(), chunk_digit_starts },
        })
    }

    #[wasm_bindgen(getter)]
    pub fn total_digits(&self) -> u64 {
        self.ds.total_digits()
    }

    #[wasm_bindgen(getter)]
    pub fn chunk_count(&self) -> usize {
        self.ds.chunk_count()
    }

    /// Exact overlapping numeric search. Returns JSON (pi-core ExactResult).
    pub fn search_exact(&self, query: &str, position_cap: usize) -> Result<String, JsValue> {
        let result = search_exact(&self.ds, query.as_bytes(), position_cap, &ScanControl::default())
            .map_err(js_err)?;
        serde_json::to_string(&result).map_err(js_err)
    }

    /// 1-based position of the first occurrence, or 0 if absent.
    pub fn find_first(&self, query: &str) -> Result<u64, JsValue> {
        find_first(&self.ds, query.as_bytes()).map_err(js_err)
    }

    /// Longest proper prefix of an absent query that does occur. JSON or "null".
    pub fn longest_existing_prefix(&self, query: &str) -> Result<String, JsValue> {
        let result = longest_existing_prefix(&self.ds, query.as_bytes(), &ScanControl::default())
            .map_err(js_err)?;
        serde_json::to_string(&result).map_err(js_err)
    }

    /// Letter search over both pair frames. `word` must already be normalized
    /// A-Z (the app's existing TS normalizer does this); values are derived here.
    pub fn search_letters(&self, word: &str, position_cap: usize) -> Result<String, JsValue> {
        let word_values: Vec<u8> = word.bytes().map(|b| b - b'A').collect();
        let result = search_letters(&self.ds, word, &word_values, position_cap, &ScanControl::default());
        serde_json::to_string(&result).map_err(js_err)
    }

    /// 2-D colour/shape pattern search. `spec_json`: {rows, cols, cells, colour_mode}.
    pub fn search_pattern(
        &self,
        spec_json: &str,
        field_cols: u64,
        match_cap: usize,
    ) -> Result<String, JsValue> {
        #[derive(Deserialize)]
        struct SpecJson {
            rows: usize,
            cols: usize,
            cells: Vec<i8>,
            colour_mode: bool,
        }
        let raw: SpecJson = serde_json::from_str(spec_json).map_err(js_err)?;
        let spec = PatternSpec {
            rows: raw.rows,
            cols: raw.cols,
            cells: raw.cells,
            colour_mode: raw.colour_mode,
        };
        let result = search_pattern(&self.ds, &spec, field_cols, match_cap, &ScanControl::default());
        serde_json::to_string(&result).map_err(js_err)
    }

    /// Date search: encode all six formats and run exact search on each.
    /// Returns JSON array of { id, label, sequence, result }.
    pub fn search_dates(&self, year: u32, month: u32, day: u32) -> Result<String, JsValue> {
        let pad = |n: u32, w: usize| {
            let s = n.to_string();
            if s.len() >= w { s } else { format!("{}{}", "0".repeat(w - s.len()), s) }
        };
        let yy = pad(year % 100, 2);
        let yyyy = pad(year, 4);
        let mm = pad(month, 2);
        let dd = pad(day, 2);
        let formats: [(&str, &str, String); 6] = [
            ("DDMMYYYY", "DDMMYYYY", format!("{dd}{mm}{yyyy}")),
            ("MMDDYYYY", "MMDDYYYY", format!("{mm}{dd}{yyyy}")),
            ("YYYYMMDD", "YYYYMMDD", format!("{yyyy}{mm}{dd}")),
            ("DDMMYY", "DDMMYY", format!("{dd}{mm}{yy}")),
            ("MMDDYY", "MMDDYY", format!("{mm}{dd}{yy}")),
            ("YYMMDD", "YYMMDD", format!("{yy}{mm}{dd}")),
        ];
        let mut rows = Vec::with_capacity(6);
        for (id, label, seq) in formats {
            let result =
                search_exact(&self.ds, seq.as_bytes(), 4096, &ScanControl::default()).map_err(js_err)?;
            rows.push(serde_json::json!({ "id": id, "label": label, "sequence": seq, "result": result }));
        }
        serde_json::to_string(&rows).map_err(js_err)
    }

    /// Whole-dataset digit counts + chi-square. JSON (pi-core DigitStats).
    pub fn compute_stats(&self) -> Result<String, JsValue> {
        let result = compute_stats(&self.ds, None).map_err(js_err)?;
        serde_json::to_string(&result).map_err(js_err)
    }

    /// ASCII digits for 1-based inclusive [start, end].
    pub fn get_window(&self, start: u64, end: u64) -> Result<String, JsValue> {
        let bytes = window_1based(&self.ds, start, end).map_err(js_err)?;
        String::from_utf8(bytes).map_err(js_err)
    }
}
