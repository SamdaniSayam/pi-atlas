//! 2-D pattern matching over the digit stream (FR-05, FR-06) — colours and
//! shapes.
//!
//! Semantics (identical to `src/engine/patternSearch.ts`):
//! - The stream folds into rows of `fieldCols` cells.
//! - Colour mode: cell value = digit (base 10). Shape mode: digit 0–4 → 0
//!   (black), 5–9 → 1 (white) (base 2).
//! - Wildcards are -1. A pattern row never matches across a row boundary:
//!   anchors are (row, col) with col + patternCols <= fieldCols.
//! - Matches report the 1-based position of the top-left cell.
//!
//! Two implementations, parity-tested against each other:
//! 1. **Direct** constraint-first compare — mirrors the TS loop exactly and
//!    serves as the reference.
//! 2. **Optimized** — a bit-parallel Shift-And filter over the first
//!    constrained pattern row (one branch-free pass per dataset row), followed
//!    by direct verification of the (rare) candidates against all pattern
//!    rows. All-wildcard patterns short-circuit to "every anchor matches".
//!
//! `search_pattern` dispatches; benchmarks in crates/bench justify the split.

use crate::Dataset;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PatternMatch {
    /// 1-based decimal position of the top-left cell.
    pub position: u64,
    pub row: u64,
    pub col: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PatternResult {
    pub matches: Vec<PatternMatch>,
    pub total: u64,
    /// Number of valid anchor positions examined.
    pub anchors: u64,
    pub capped: bool,
    pub incomplete: bool,
}

#[derive(Debug, Clone)]
pub struct PatternSpec {
    pub rows: usize,
    pub cols: usize,
    /// rows*cols values; -1 = wildcard; colour mode 0-9, shape mode 0-1.
    pub cells: Vec<i8>,
    pub colour_mode: bool,
}

impl PatternSpec {
    pub fn constrained(&self) -> usize {
        self.cells.iter().filter(|&&v| v != -1).count()
    }

    /// Expected matches under the uniform model (matches TS expectedPatternMatches).
    pub fn expected_matches(&self, field_cols: u64, dataset_size: u64) -> f64 {
        let base: f64 = if self.colour_mode { 10.0 } else { 2.0 };
        let rows = (dataset_size / field_cols) as f64;
        let anchors = (rows - self.rows as f64 + 1.0).max(0.0)
            * (field_cols as f64 - self.cols as f64 + 1.0).max(0.0);
        anchors / base.powi(self.constrained() as i32)
    }
}

fn row_constraints(spec: &PatternSpec) -> Vec<Vec<(usize, i8)>> {
    (0..spec.rows)
        .map(|r| {
            (0..spec.cols)
                .filter_map(|c| {
                    let v = spec.cells[r * spec.cols + c];
                    (v != -1).then_some((c, v))
                })
                .collect()
        })
        .collect()
}

fn cell_class(digit: u8, colour_mode: bool) -> usize {
    // `digit` is already a digit VALUE (0-9) — callers subtract b'0' first.
    if colour_mode {
        digit as usize
    } else if digit < 5 {
        0
    } else {
        1
    }
}

fn num_classes(colour_mode: bool) -> usize {
    if colour_mode {
        10
    } else {
        2
    }
}

pub fn search_pattern(
    ds: &Dataset,
    spec: &PatternSpec,
    field_cols: u64,
    match_cap: usize,
    ctl: &crate::exact::ScanControl<'_>,
) -> PatternResult {
    // The optimized Shift-And filter is benchmarked separately; the direct
    // TS-parity scan is the reference and is currently the default.
    search_pattern_direct(ds, spec, field_cols, match_cap, ctl)
}

/// Direct TS-parity scan.
pub fn search_pattern_direct(
    ds: &Dataset,
    spec: &PatternSpec,
    field_cols: u64,
    match_cap: usize,
    ctl: &crate::exact::ScanControl<'_>,
) -> PatternResult {
    let mut out = PatternResult {
        matches: Vec::new(),
        total: 0,
        anchors: 0,
        capped: false,
        incomplete: false,
    };
    let total_rows = ds.total_digits() / field_cols;
    if spec.rows as u64 > total_rows || field_cols < spec.cols as u64 {
        return out;
    }
    let constraints = row_constraints(spec);
    let max_col = (field_cols - spec.cols as u64) as i64;
    let mut row_digits: Vec<Vec<u8>> = vec![Vec::new(); spec.rows];

    let mut row: u64 = 0;
    while row + spec.rows as u64 <= total_rows {
        if (ctl.is_cancelled)() || ctl.deadline.map_or(false, |d| std::time::Instant::now() > d) {
            out.incomplete = true;
            return out;
        }
        for (pr, buf) in row_digits.iter_mut().enumerate() {
            buf.clear();
            unpack_window(ds, (row + pr as u64) * field_cols, field_cols, buf);
        }
        for col in 0..=max_col {
            out.anchors += 1;
            let mut ok = true;
            'outer: for (pr, cons) in constraints.iter().enumerate() {
                if cons.is_empty() {
                    continue;
                }
                let line = &row_digits[pr];
                for &(pc, pv) in cons {
                    let d = line[(col + pc as i64) as usize] - b'0';
                    if cell_class(d, spec.colour_mode) != pv as usize {
                        ok = false;
                        break 'outer;
                    }
                }
            }
            if ok {
                push_match(&mut out, row * field_cols + col as u64 + 1, row, col as u64, match_cap);
            }
        }
        row += 1;
        if row % 262_144 == 0 {
            if let Some(p) = ctl.on_progress {
                p(row, total_rows);
            }
        }
    }
    if let Some(p) = ctl.on_progress {
        p(total_rows, total_rows);
    }
    out
}

/// Shift-And filtered scan.
pub fn search_pattern_optimized(
    ds: &Dataset,
    spec: &PatternSpec,
    field_cols: u64,
    match_cap: usize,
    ctl: &crate::exact::ScanControl<'_>,
) -> PatternResult {
    let mut out = PatternResult {
        matches: Vec::new(),
        total: 0,
        anchors: 0,
        capped: false,
        incomplete: false,
    };
    let total_rows = ds.total_digits() / field_cols;
    if spec.rows as u64 > total_rows || field_cols < spec.cols as u64 {
        return out;
    }
    let anchor_rows = total_rows - spec.rows as u64 + 1;
    let max_col = (field_cols - spec.cols as u64) as i64;
    out.anchors = anchor_rows * (max_col + 1) as u64;

    let constraints = row_constraints(spec);
    let p_cols = spec.cols as i64;

    // First constrained pattern row (filter row).
    let pr0 = constraints
        .iter()
        .position(|r| !r.is_empty())
        .unwrap_or(spec.rows); // usize::MAX-equivalent only when all wildcards

    if pr0 == spec.rows {
        // All wildcards: every anchor matches.
        for row in 0..anchor_rows {
            for col in 0..=max_col {
                push_match(&mut out, row * field_cols + col as u64 + 1, row, col as u64, match_cap);
            }
            if (ctl.is_cancelled)() || ctl.deadline.map_or(false, |d| std::time::Instant::now() > d) {
                out.incomplete = true;
                return out;
            }
        }
        if let Some(p) = ctl.on_progress {
            p(anchor_rows, anchor_rows);
        }
        return out;
    }

    let n_classes = num_classes(spec.colour_mode);
    // class_mask[k]: bit c set ⇔ pattern row pr0 col c accepts class k.
    // Wildcard cells accept every class.
    let mut class_mask = vec![0u64; n_classes];
    for c in 0..spec.cols {
        let v = spec.cells[pr0 * spec.cols + c];
        if v == -1 {
            for mask in class_mask.iter_mut() {
                *mask |= 1u64 << c;
            }
        } else {
            class_mask[v as usize] |= 1u64 << c;
        }
    }

    // For dataset row R, filter row pr0 anchors at dataset row (R - pr0).
    // Valid anchor rows: 0 ..= anchor_rows-1 ⇒ R in [pr0, pr0 + anchor_rows).
    let mut row_digits: Vec<u8> = Vec::with_capacity(field_cols as usize);
    let mut m: u64;
    for r in pr0 as u64..(pr0 as u64 + anchor_rows) {
        if (ctl.is_cancelled)() || ctl.deadline.map_or(false, |d| std::time::Instant::now() > d) {
            out.incomplete = true;
            return out;
        }
        row_digits.clear();
        unpack_window(ds, r * field_cols, field_cols, &mut row_digits);
        m = 0;
        for col in 0..field_cols as usize {
            let cls = cell_class(row_digits[col] - b'0', spec.colour_mode);
            m = (m << 1) | 1;
            m &= class_mask[cls];
            // Pattern row pr0 fully consumed ⇔ bit (p_cols-1) set ⇒ candidate
            // anchor col = col - p_cols + 1.
            if m >> (p_cols - 1) & 1 == 1 {
                let a_col = col as i64 - p_cols + 1;
                if a_col >= 0 && a_col <= max_col {
                    let a_row = r - pr0 as u64;
                    if verify_candidate(ds, spec, field_cols, a_row, a_col as u64) {
                        push_match(
                            &mut out,
                            a_row * field_cols + a_col as u64 + 1,
                            a_row,
                            a_col as u64,
                            match_cap,
                        );
                    }
                }
            }
        }
        if r % 262_144 == 0 {
            if let Some(p) = ctl.on_progress {
                p(r - pr0 as u64, anchor_rows);
            }
        }
    }
    if let Some(p) = ctl.on_progress {
        p(anchor_rows, anchor_rows);
    }
    out
}

/// Verify all pattern rows at anchor (row, col) against the packed data.
fn verify_candidate(
    ds: &Dataset,
    spec: &PatternSpec,
    field_cols: u64,
    row: u64,
    col: u64,
) -> bool {
    let constraints = row_constraints(spec);
    let mut line: Vec<u8> = Vec::with_capacity(field_cols as usize);
    for (pr, cons) in constraints.iter().enumerate() {
        if cons.is_empty() {
            continue;
        }
        line.clear();
        unpack_window(ds, (row + pr as u64) * field_cols, field_cols, &mut line);
        for &(pc, pv) in cons {
            let d = line[(col + pc as u64) as usize] - b'0';
            if cell_class(d, spec.colour_mode) != pv as usize {
                return false;
            }
        }
    }
    true
}

fn push_match(out: &mut PatternResult, position: u64, row: u64, col: u64, match_cap: usize) {
    out.total += 1;
    if out.matches.len() < match_cap {
        out.matches.push(PatternMatch { position, row, col });
    } else {
        out.capped = true;
    }
}

/// Unpack `count` digits starting at 0-based `start` into `buf` as ASCII.
fn unpack_window(ds: &Dataset, start: u64, count: u64, buf: &mut Vec<u8>) {
    assert!(
        start + count <= ds.total_digits(),
        "unpack_window out of bounds: start={start} count={count} total={}",
        ds.total_digits()
    );
    buf.reserve(count as usize);
    let mut pos = start;
    let end = start + count;
    while pos < end {
        let chunk_idx = (pos / ds.manifest.chunk_digits) as usize;
        let chunk_start = ds.chunk_digit_starts[chunk_idx];
        let chunk_len = ds.chunk_digits(chunk_idx);
        let within = pos - chunk_start;
        // Odd positions within a chunk are not byte-aligned: emit the single
        // nibble first, then keep going byte-aligned.
        if within % 2 == 1 {
            buf.push(b'0' + ds.digit(pos));
            pos += 1;
            continue;
        }
        let take = (chunk_len - within).min(end - pos);
        let take_even = take - (take % 2);
        if take_even > 0 {
            let base_byte = (within / 2) as usize;
            crate::pack::unpack_into(&ds.chunks[chunk_idx][base_byte..], 0, take_even, buf);
            pos += take_even;
        }
        if take > take_even {
            let d = ds.digit(pos);
            buf.push(b'0' + d);
            pos += 1;
        }
    }
}

/// Reconstruct the full ASCII stream (diagnostics/tests).
pub fn unpack_dataset_ascii(ds: &Dataset) -> Vec<u8> {
    let mut out = Vec::with_capacity(ds.total_digits() as usize);
    unpack_window(ds, 0, ds.total_digits(), &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exact::ScanControl;

    fn ds(ascii: &[u8]) -> Dataset {
        crate::testutil::build_dataset(ascii, 20)
    }

    #[test]
    fn single_digit_shape_row() {
        // Shape mode: black (0-4) →0, white (5-9)→1.
        // Data: rows 0 = "04159" (black,black,black,black,white)
        //       row 1 = "26535" (black,white,black,white,white)
        let d = ds(b"0415926535");
        let spec = PatternSpec { rows: 1, cols: 2, cells: vec![0, 1], colour_mode: false };
        let r = search_pattern(&d, &spec, 5, 1000, &ScanControl::default());
        // Expected matches: row0 col2 (digits 1,5 -> black,white) pos 3
        //                    row1 col0 (2,6 -> black,white) pos 6
        //                    row1 col3 (3,5 -> black,white) pos 9
        assert_eq!(r.total, 3);
        assert_eq!(r.anchors, 8);
        let positions: Vec<u64> = r.matches.iter().map(|m| m.position).collect();
        assert_eq!(positions, vec![3, 6, 9]);
    }

    #[test]
    fn colour_wildcard_and_boundaries() {
        let d = ds(b"1234567890");
        let spec = PatternSpec { rows: 1, cols: 3, cells: vec![1, -1, 3], colour_mode: true };
        let r = search_pattern(&d, &spec, 5, 1000, &ScanControl::default());
        assert_eq!(r.total, 1);
        assert_eq!(r.matches[0].position, 1);
        assert_eq!(r.anchors, 6);
    }

    #[test]
    fn multi_row_never_spans_boundary() {
        let d = ds(b"1200012000");
        let spec = PatternSpec {
            rows: 2,
            cols: 3,
            cells: vec![1, 2, 0, 1, 2, 0],
            colour_mode: true,
        };
        let r = search_pattern(&d, &spec, 5, 1000, &ScanControl::default());
        assert_eq!(r.total, 1);
        assert_eq!(r.matches[0].position, 1);
        assert_eq!(r.matches[0].row, 0);
        assert_eq!(r.matches[0].col, 0);
    }

    #[test]
    fn all_wildcards_matches_every_anchor() {
        let d = ds(b"1234567890");
        let spec = PatternSpec { rows: 1, cols: 2, cells: vec![-1, -1], colour_mode: true };
        let r = search_pattern(&d, &spec, 5, 1000, &ScanControl::default());
        assert_eq!(r.total, 8); // 2 rows × 4 anchors
        assert_eq!(r.anchors, 8);
    }

    #[test]
    fn pattern_larger_than_field_has_zero_anchors() {
        let d = ds(b"1234567890");
        let spec = PatternSpec { rows: 1, cols: 3, cells: vec![1, 2, 3], colour_mode: true };
        let r = search_pattern(&d, &spec, 2, 1000, &ScanControl::default());
        assert_eq!(r.total, 0);
        assert_eq!(r.anchors, 0);
    }

    /// The optimized scan must agree with the direct reference everywhere,
    /// including matches spanning chunk boundaries.
    #[test]
    fn parity_optimized_vs_direct_randomised() {
        use rand::SeedableRng;
        let mut rng = rand::rngs::StdRng::seed_from_u64(7);
        use rand::Rng;
        let ascii: Vec<u8> = (0..2_000).map(|_| b'0' + rng.gen_range(0..10)).collect();
        let d = ds(&ascii);
        for field_cols in [5u64, 8, 10] {
            for rows in [1usize, 2, 3] {
                for cols in [1usize, 2, 3] {
                    // Binary (shape) and colour, with wildcards sprinkled in.
                    for colour in [true, false] {
                        let hi = if colour { 10 } else { 2 };
                        let cells: Vec<i8> = (0..rows * cols)
                            .map(|_| if rng.gen_bool(0.3) { -1 } else { rng.gen_range(0..hi) as i8 })
                            .collect();
                        let spec = PatternSpec { rows, cols, cells, colour_mode: colour };
                        let a = search_pattern_direct(&d, &spec, field_cols, 10_000, &ScanControl::default());
                        let b = search_pattern_optimized(&d, &spec, field_cols, 10_000, &ScanControl::default());
                        assert_eq!(a.total, b.total, "spec rows={rows} cols={cols} colour={colour} fc={field_cols}");
                        assert_eq!(a.matches, b.matches, "spec rows={rows} cols={cols} colour={colour} fc={field_cols}");
                        assert_eq!(a.anchors, b.anchors);
                    }
                }
            }
        }
    }
}
