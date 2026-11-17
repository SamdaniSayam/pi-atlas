//! Browser WASM engine over the *unchanged* `pi-core` search algorithms.
//!
//! Stage 4: the engine holds packed digits **per chunk**, so the browser only
//! materialises the chunks it has actually downloaded and SHA-256 verified.
//! JS drives the flow: construct from the core manifest, `set_chunk(i, bytes)`
//! for each chunk it loads, then call a search/window method. No algorithm is
//! reimplemented here — every method delegates to the same Rust code the HTTP
//! service uses, so Rust-vs-WASM parity (Stage 5) compares identical logic.
//!
//! Memory note: the engine owns exactly ONE `Dataset` whose `chunks` buffers
//! are filled in place by `set_chunk`. Searches borrow `&self.dataset`; nothing
//! is cloned per call. For the 1B dataset the resident payload is ~500 MB, not
//! the ~1 GB a per-search clone would require.

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

/// Guard the public WASM boundary. The Worker already normalizes inputs, but
/// PiEngine is exported directly, so invalid input must return an error rather
/// than panic (Rust panics across the WASM ABI are hard to diagnose in JS).
fn validate_digits(query: &str, cap: usize, max_len: usize) -> Result<(), JsValue> {
    if query.is_empty() {
        return Err(js_err("query is empty"));
    }
    if query.len() > max_len {
        return Err(js_err(format!("query longer than {max_len} digits")));
    }
    if !query.bytes().all(|b| b.is_ascii_digit()) {
        return Err(js_err("query contains non-digit bytes"));
    }
    if cap == 0 {
        return Err(js_err("position_cap must be positive"));
    }
    Ok(())
}

fn validate_word(word: &str, cap: usize) -> Result<(), JsValue> {
    if word.is_empty() || word.len() > 12 {
        return Err(js_err("word must contain 1..=12 A-Z letters"));
    }
    if !word.bytes().all(|b| (b'A'..=b'Z').contains(&b)) {
        return Err(js_err("word must be normalized uppercase A-Z"));
    }
    if cap == 0 {
        return Err(js_err("position_cap must be positive"));
    }
    Ok(())
}

fn valid_date(y: u32, m: u32, d: u32) -> bool {
    if !(1..=9999).contains(&y) || !(1..=12).contains(&m) || d == 0 {
        return false;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    d <= days[(m - 1) as usize]
}

/// A checksum-verified dataset loaded into the WASM engine, chunk by chunk.
#[wasm_bindgen]
pub struct PiEngine {
    manifest: Manifest,
    dataset: Dataset,
    /// Which `dataset.chunks` entries have been verified and filled.
    loaded: Vec<bool>,
}

#[wasm_bindgen]
impl PiEngine {
    /// Build an empty engine from a `pi-atlas-packed-v1` **core** manifest JSON
    /// string. No digit bytes are resident yet; call `set_chunk` for each chunk.
    #[wasm_bindgen(constructor)]
    pub fn new(manifest_json: &str) -> Result<PiEngine, JsValue> {
        let manifest: Manifest = serde_json::from_str(manifest_json).map_err(js_err)?;
        manifest.validate().map_err(js_err)?;
        let count = manifest.chunks.len();
        let mut chunk_digit_starts = Vec::with_capacity(count);
        let mut acc = 0u64;
        for meta in &manifest.chunks {
            chunk_digit_starts.push(acc);
            acc += meta.digits;
        }
        let dataset = Dataset {
            manifest: manifest.clone(),
            chunks: vec![Vec::new(); count],
            chunk_digit_starts,
        };
        Ok(PiEngine {
            manifest,
            dataset,
            loaded: vec![false; count],
        })
    }

    #[wasm_bindgen(getter)]
    pub fn total_digits(&self) -> u64 {
        self.manifest.total_digits
    }

    #[wasm_bindgen(getter)]
    pub fn chunk_count(&self) -> usize {
        self.manifest.chunks.len()
    }

    /// True when chunk `index` has been verified and stored.
    pub fn has_chunk(&self, index: usize) -> bool {
        self.loaded.get(index).copied().unwrap_or(false)
    }

    /// Number of verified chunks currently resident.
    pub fn loaded_chunks(&self) -> usize {
        self.loaded.iter().filter(|b| **b).count()
    }

    /// Verify and store one packed chunk. Checks byte length and per-chunk
    /// SHA-256 from the manifest before the bytes become resident. Re-loading a
    /// chunk is idempotent; a corrupt chunk is rejected and not stored.
    pub fn set_chunk(&mut self, index: usize, bytes: &[u8]) -> Result<(), JsValue> {
        let meta = self
            .manifest
            .chunks
            .get(index)
            .ok_or_else(|| js_err("chunk index out of range"))?;
        if bytes.len() != meta.bytes as usize {
            return Err(js_err(format!(
                "chunk {index}: expected {} bytes, got {}",
                meta.bytes,
                bytes.len()
            )));
        }
        let got = pi_core::manifest::sha256_hex(bytes);
        if got != meta.sha256 {
            return Err(js_err(format!(
                "chunk {index}: sha256 mismatch (expected {}, got {got})",
                meta.sha256
            )));
        }
        self.dataset.chunks[index].clear();
        self.dataset.chunks[index].extend_from_slice(bytes);
        self.loaded[index] = true;
        Ok(())
    }

    /// Drop a single resident chunk (memory pressure / cache eviction).
    pub fn drop_chunk(&mut self, index: usize) {
        if index < self.chunks_len() {
            self.dataset.chunks[index].clear();
            self.loaded[index] = false;
        }
    }

    /// Drop all resident chunks.
    pub fn clear_chunks(&mut self) {
        for (i, loaded) in self.loaded.iter_mut().enumerate() {
            if *loaded {
                self.dataset.chunks[i].clear();
            }
            *loaded = false;
        }
    }

    fn chunks_len(&self) -> usize {
        self.loaded.len()
    }

    /// Ensure all chunks are resident (full scans need the whole dataset).
    fn require_all(&self) -> Result<(), JsValue> {
        let missing = self.loaded.iter().filter(|b| !**b).count();
        if missing > 0 {
            Err(js_err(format!(
                "{missing} chunk(s) not loaded; load all chunks before a full search"
            )))
        } else {
            Ok(())
        }
    }

    /// Ensure the chunks covering a 1-based inclusive range are resident.
    fn require_range(&self, start: u64, end: u64) -> Result<(), JsValue> {
        if start == 0 || end < start || end > self.manifest.total_digits {
            return Err(js_err("window range out of bounds"));
        }
        let cd = self.manifest.chunk_digits;
        let first = ((start - 1) / cd) as usize;
        let last = ((end - 1) / cd) as usize;
        for c in first..=last {
            if !self.loaded.get(c).copied().unwrap_or(false) {
                return Err(js_err(format!("chunk {c} not loaded for window [{start}, {end}]")));
            }
        }
        Ok(())
    }

    /// Exact overlapping numeric search. Returns JSON (pi-core ExactResult).
    pub fn search_exact(&self, query: &str, position_cap: usize) -> Result<String, JsValue> {
        validate_digits(query, position_cap, 4096)?;
        self.require_all()?;
        let result = search_exact(
            &self.dataset,
            query.as_bytes(),
            position_cap,
            &ScanControl::default(),
        )
        .map_err(js_err)?;
        serde_json::to_string(&result).map_err(js_err)
    }

    /// 1-based position of the first occurrence, or 0 if absent.
    pub fn find_first(&self, query: &str) -> Result<u64, JsValue> {
        validate_digits(query, 1, 4096)?;
        self.require_all()?;
        find_first(&self.dataset, query.as_bytes()).map_err(js_err)
    }

    /// Longest proper prefix of an absent query that does occur. JSON or "null".
    pub fn longest_existing_prefix(&self, query: &str) -> Result<String, JsValue> {
        validate_digits(query, 1, 4096)?;
        self.require_all()?;
        let result =
            longest_existing_prefix(&self.dataset, query.as_bytes(), &ScanControl::default())
                .map_err(js_err)?;
        serde_json::to_string(&result).map_err(js_err)
    }

    /// Letter search over both pair frames. `word` must already be normalized
    /// A-Z by the caller (the app's TS normalizer); values are derived here.
    pub fn search_letters(&self, word: &str, position_cap: usize) -> Result<String, JsValue> {
        validate_word(word, position_cap)?;
        self.require_all()?;
        let word_values: Vec<u8> = word.bytes().map(|b| b - b'A').collect();
        let result = search_letters(
            &self.dataset,
            word,
            &word_values,
            position_cap,
            &ScanControl::default(),
        );
        serde_json::to_string(&result).map_err(js_err)
    }

    /// 2-D colour/shape pattern search. `spec_json`: {rows, cols, cells, colour_mode}.
    pub fn search_pattern(
        &self,
        spec_json: &str,
        field_cols: u64,
        match_cap: usize,
    ) -> Result<String, JsValue> {
        self.require_all()?;
        #[derive(Deserialize)]
        struct SpecJson {
            rows: usize,
            cols: usize,
            cells: Vec<i8>,
            colour_mode: bool,
        }
        let raw: SpecJson = serde_json::from_str(spec_json).map_err(js_err)?;
        if !(1..=64).contains(&raw.rows) || !(1..=64).contains(&raw.cols) {
            return Err(js_err("rows and cols must be in 1..=64"));
        }
        if raw.cells.len() != raw.rows * raw.cols {
            return Err(js_err("cells length must equal rows * cols"));
        }
        let value_cap: i8 = if raw.colour_mode { 9 } else { 1 };
        let constrained = raw.cells.iter().filter(|v| **v != -1).count();
        if raw.cells.iter().any(|v| *v < -1 || *v > value_cap) {
            return Err(js_err(format!("cell value out of range (-1..={value_cap})")));
        }
        if constrained < 2 {
            return Err(js_err("at least 2 constrained cells are required"));
        }
        if field_cols < raw.cols as u64 || field_cols > 4096 {
            return Err(js_err("field_cols must be >= cols and <= 4096"));
        }
        if match_cap == 0 {
            return Err(js_err("match_cap must be positive"));
        }
        let spec = PatternSpec {
            rows: raw.rows,
            cols: raw.cols,
            cells: raw.cells,
            colour_mode: raw.colour_mode,
        };
        let result = search_pattern(
            &self.dataset,
            &spec,
            field_cols,
            match_cap,
            &ScanControl::default(),
        );
        serde_json::to_string(&result).map_err(js_err)
    }

    /// Date search: encode all six formats and run exact search on each.
    /// Returns JSON array of { id, label, sequence, result }.
    pub fn search_dates(&self, year: u32, month: u32, day: u32) -> Result<String, JsValue> {
        if !valid_date(year, month, day) {
            return Err(js_err("invalid date"));
        }
        self.require_all()?;
        let pad = |n: u32, w: usize| {
            let s = n.to_string();
            if s.len() >= w {
                s
            } else {
                format!("{}{}", "0".repeat(w - s.len()), s)
            }
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
            let result = search_exact(
                &self.dataset,
                seq.as_bytes(),
                10_000,
                &ScanControl::default(),
            )
            .map_err(js_err)?;
            rows.push(serde_json::json!({
                "id": id,
                "label": label,
                "sequence": seq,
                "result": result,
            }));
        }
        serde_json::to_string(&rows).map_err(js_err)
    }

    /// Whole-dataset digit counts + chi-square. JSON (pi-core DigitStats).
    pub fn compute_stats(&self) -> Result<String, JsValue> {
        self.require_all()?;
        let result = compute_stats(&self.dataset, None).map_err(js_err)?;
        serde_json::to_string(&result).map_err(js_err)
    }

    /// ASCII digits for 1-based inclusive [start, end]. Only the chunks
    /// covering the range need to be resident.
    pub fn get_window(&self, start: u64, end: u64) -> Result<String, JsValue> {
        self.require_range(start, end)?;
        let bytes = window_1based(&self.dataset, start, end).map_err(js_err)?;
        String::from_utf8(bytes).map_err(js_err)
    }

    /// Read a single digit by 1-based position (for evenly spread samples).
    /// Only the single owning chunk needs to be resident.
    pub fn get_digit(&self, position: u64) -> Result<u8, JsValue> {
        if position == 0 || position > self.manifest.total_digits {
            return Err(js_err("position out of range"));
        }
        let c = ((position - 1) / self.manifest.chunk_digits) as usize;
        if !self.loaded.get(c).copied().unwrap_or(false) {
            return Err(js_err("chunk not loaded"));
        }
        let bytes = &self.dataset.chunks[c];
        let within = (position - 1) % self.manifest.chunk_digits;
        let byte = bytes[(within / 2) as usize];
        Ok(if within % 2 == 0 {
            byte >> 4
        } else {
            byte & 0x0f
        })
    }
}
