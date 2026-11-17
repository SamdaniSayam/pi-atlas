//! Exact numeric search over the packed dataset.
//!
//! Streaming over chunks with a boundary-safe carry: the last `L-1` digits of
//! the previous chunk are prepended to the current chunk so patterns spanning
//! chunk edges are found. Matches that start inside the carry region but end
//! within it were already counted by the previous chunk and are skipped;
//! matches that extend past the previous chunk's end were invisible to it and
//! are counted here. No match is ever omitted or double-counted (parity-tested
//! against a whole-dataset scan).

use crate::{CoreError, Dataset};

#[derive(Debug, Clone, serde::Serialize)]
pub struct ExactResult {
    /// Total occurrence count over the whole dataset (uncapped, overlapping).
    pub total: u64,
    /// 1-based positions, ascending, capped by the caller's limit.
    pub positions: Vec<u64>,
    /// True when `total > positions.len()` (positions list was capped).
    pub truncated: bool,
    /// Set when cancellation or deadline stopped the scan early.
    pub incomplete: bool,
}

/// Controls applied while scanning (cancellation, deadlines, progress).
pub struct ScanControl<'a> {
    pub is_cancelled: &'a (dyn Fn() -> bool + 'a),
    pub deadline: Option<std::time::Instant>,
    pub on_progress: Option<&'a (dyn Fn(u64, u64) + 'a)>,
}

fn never() -> bool {
    false
}

static NEVER: fn() -> bool = never;

impl Default for ScanControl<'_> {
    fn default() -> Self {
        ScanControl { is_cancelled: &NEVER, deadline: None, on_progress: None }
    }
}

impl ExactResult {
    pub fn empty() -> Self {
        ExactResult { total: 0, positions: Vec::new(), truncated: false, incomplete: false }
    }
}

/// Find all (overlapping) occurrences of `query` (ASCII digits) in a byte
/// string. Seeding with `memchr` on the first digit + early-exit verification.
fn find_all_overlapping<'a>(haystack: &'a [u8], query: &[u8]) -> impl Iterator<Item = usize> + 'a {
    let first = query[0];
    let rest: Vec<u8> = query[1..].to_vec();
    let qlen = query.len();
    memchr::memchr_iter(first, haystack).filter(move |&i| {
        i + qlen <= haystack.len() && &haystack[i + 1..i + qlen] == rest.as_slice()
    })
}

/// KMP failure function over raw digit values.
fn failure_fn(values: &[u8]) -> Vec<usize> {
    let mut f = vec![0usize; values.len()];
    let mut k = 0usize;
    for i in 1..values.len() {
        while k > 0 && values[i] != values[k] {
            k = f[k - 1];
        }
        if values[i] == values[k] {
            k += 1;
        }
        f[i] = k;
    }
    f
}

/// Longest proper prefix of `query` that occurs anywhere in the dataset,
/// and the 1-based position of its first occurrence. Mirrors the TS engine:
/// only meaningful when the full query does not occur; returns `None` when
/// no proper prefix occurs. Runs a single KMP pass; intended to be called
/// only when `search_exact` found nothing (TS computes it lazily).
pub fn longest_existing_prefix(
    ds: &Dataset,
    query: &[u8],
    ctl: &ScanControl<'_>,
) -> Result<Option<(u64, u64)>, CoreError> {
    let l = query.len();
    if l <= 1 {
        return Ok(None);
    }
    let values: Vec<u8> = query.iter().map(|&b| b - b'0').collect();
    let f = failure_fn(&values);
    let mut first_end = vec![u64::MAX; l]; // first_end[s] = 0-based end index of first occurrence of prefix s
    let mut scratch: Vec<u8> = Vec::new();
    let mut s = 0usize;
    let mut base = 0u64; // 0-based digit offset of scratch[0]
    for c in 0..ds.chunk_count() {
        if (ctl.is_cancelled)() {
            return Err(CoreError::Verify("cancelled".into()));
        }
        if let Some(d) = ctl.deadline {
            if std::time::Instant::now() > d {
                return Ok(None); // deadline: omit prefix info rather than lie
            }
        }
        let chunk_start = ds.chunk_digit_starts[c];
        let chunk_digits = ds.chunk_digits(c);
        let packed_slice = &ds.packed[chunk_start as usize / 2..(chunk_start + chunk_digits) as usize / 2];
        scratch.clear();
        crate::pack::unpack_into(packed_slice, 0, chunk_digits, &mut scratch);
        base = chunk_start;
        for (i, &b) in scratch.iter().enumerate() {
            let v = b - b'0';
            while s > 0 && v != values[s] {
                s = f[s - 1];
            }
            if v == values[s] {
                s += 1;
            }
            if s == l {
                s = f[s - 1];
            }
            if s >= 1 && first_end[s] == u64::MAX {
                first_end[s] = base + i as u64;
            }
        }
        if let Some(p) = ctl.on_progress {
            p(base + chunk_digits, ds.total_digits());
        }
    }
    for s in (1..l).rev() {
        if first_end[s] != u64::MAX {
            let pos = first_end[s] + 2 - s as u64; // 1-based start
            return Ok(Some((s as u64, pos)));
        }
    }
    Ok(None)
}

/// Search the whole dataset for `query` (ASCII digit bytes).
pub fn search_exact(
    ds: &Dataset,
    query: &[u8],
    position_cap: usize,
    ctl: &ScanControl<'_>,
) -> Result<ExactResult, CoreError> {
    if query.is_empty() {
        return Err(CoreError::Verify("empty query".into()));
    }
    for &b in query {
        if !b.is_ascii_digit() {
            return Err(CoreError::Verify(format!("non-digit in query: {}", b as char)));
        }
    }
    let mut result = ExactResult::empty();
    result.positions.reserve(position_cap.min(4096));
    let overlap = query.len() - 1;
    let mut carry: Vec<u8> = Vec::new(); // ASCII tail of previous chunk (overlap digits)
    let mut scratch: Vec<u8> = Vec::new();

    for c in 0..ds.chunk_count() {
        if (ctl.is_cancelled)() {
            result.incomplete = true;
            return Ok(result);
        }
        if let Some(d) = ctl.deadline {
            if std::time::Instant::now() > d {
                result.incomplete = true;
                return Ok(result);
            }
        }
        let chunk_start = ds.chunk_digit_starts[c]; // 0-based digit offset
        let chunk_digits = ds.chunk_digits(c);
        let packed_slice = &ds.packed[chunk_start as usize / 2..(chunk_start + chunk_digits) as usize / 2];

        scratch.clear();
        scratch.extend_from_slice(&carry);
        crate::pack::unpack_into(packed_slice, 0, chunk_digits, &mut scratch);

        // Global 0-based digit offset of scratch[0].
        let scratch_start = chunk_start - carry.len() as u64;
        for i in find_all_overlapping(&scratch, query) {
            let global = scratch_start + i as u64; // 0-based
            // Skip matches that start AND end inside the previous chunk.
            if c > 0 && global + query.len() as u64 <= chunk_start {
                continue;
            }
            result.total += 1;
            if result.positions.len() < position_cap {
                result.positions.push(global + 1); // 1-based
            }
        }

        // New carry: last `overlap` digits of the virtual stream so far.
        // (Accumulate rather than replace: when chunk_digits < overlap — only
        // in tests — the carry must span several chunks.)
        if overlap > 0 {
            let keep = overlap.min(scratch.len());
            carry.clear();
            carry.extend_from_slice(&scratch[scratch.len() - keep..]);
        }

        if let Some(p) = ctl.on_progress {
            let done = chunk_start + chunk_digits;
            p(done, ds.total_digits());
        }
    }

    result.truncated = result.total > result.positions.len() as u64;
    Ok(result)
}

/// First occurrence only (1-based position or 0). Early-exits at the first hit.
pub fn find_first(ds: &Dataset, query: &[u8]) -> Result<u64, CoreError> {
    if query.is_empty() || query.len() > ds.total_digits() as usize {
        return Ok(0);
    }
    let overlap = query.len() - 1;
    let mut carry: Vec<u8> = Vec::new();
    let mut scratch: Vec<u8> = Vec::new();
    for c in 0..ds.chunk_count() {
        let chunk_start = ds.chunk_digit_starts[c];
        let chunk_digits = ds.chunk_digits(c);
        let packed_slice = &ds.packed[chunk_start as usize / 2..(chunk_start + chunk_digits) as usize / 2];
        scratch.clear();
        scratch.extend_from_slice(&carry);
        crate::pack::unpack_into(packed_slice, 0, chunk_digits, &mut scratch);
        let scratch_start = chunk_start - carry.len() as u64;
        for i in find_all_overlapping(&scratch, query) {
            let global = scratch_start + i as u64;
            if c > 0 && global + query.len() as u64 <= chunk_start {
                continue;
            }
            return Ok(global + 1);
        }
        if overlap > 0 {
            let keep = overlap.min(scratch.len());
            carry.clear();
            carry.extend_from_slice(&scratch[scratch.len() - keep..]);
        }
    }
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pack::pack_digits;
    use crate::manifest::{ChunkMeta, Manifest, FORMAT_ID};
    use rand::{Rng, SeedableRng};

    fn build_dataset(ascii: &[u8], chunk_digits: usize) -> Dataset {
        assert_eq!(ascii.len() % 2, 0);
        assert_eq!(chunk_digits % 2, 0);
        let mut packed = Vec::new();
        let mut chunks = Vec::new();
        let mut starts = vec![0u64];
        for block in ascii.chunks(chunk_digits) {
            let p = pack_digits(block);
            chunks.push(ChunkMeta {
                digits: block.len() as u64,
                bytes: p.len() as u64,
                sha256: crate::manifest::sha256_hex(&p),
            });
            packed.extend_from_slice(&p);
            starts.push(starts.last().unwrap() + block.len() as u64);
        }
        starts.pop(); // last entry is the end offset
        let manifest = Manifest {
            format: FORMAT_ID.to_string(),
            total_digits: ascii.len() as u64,
            chunk_digits: chunk_digits as u64,
            first_digits: String::from_utf8(ascii[..ascii.len().min(64)].to_vec()).unwrap(),
            checkpoints: vec![],
            sha256_packed: crate::manifest::sha256_hex(&packed),
            chunks,
        };
        manifest.validate().unwrap();
        manifest.verify_packed(&packed).unwrap();
        Dataset { manifest, packed, chunk_digit_starts: starts }
    }

    /// Reference: the TS engine's overlapping indexOf scan.
    fn reference_all(haystack: &[u8], needle: &[u8]) -> Vec<u64> {
        let mut out = Vec::new();
        let mut from = 0usize;
        while let Some(rel) = haystack[from..]
            .windows(needle.len())
            .position(|w| w == needle)
        {
            let idx = from + rel;
            out.push(idx as u64 + 1);
            from = idx + 1;
        }
        out
    }

    #[test]
    fn parity_with_reference_on_tricky_data() {
        // Data engineered with heavy self-overlap ("11", "111", "101"...).
        let ascii = b"11101110111011111000111010111011101110111011101110";
        for chunk_digits in [2usize, 4, 10, 50] {
            let ds = build_dataset(ascii, chunk_digits);
            for query in [
                &b"1"[..], &b"11"[..], &b"111"[..], &b"1111"[..], &b"101"[..],
                &b"1110111"[..], &b"000"[..], &b"9"[..], &b"11101110111011111"[..],
            ] {
                let got = search_exact(&ds, query, 1000, &ScanControl::default()).unwrap();
                let want = reference_all(ascii, query);
                assert_eq!(got.positions, want, "query {query:?} chunks {chunk_digits}");
                assert_eq!(got.total as usize, want.len());
                assert!(!got.truncated && !got.incomplete);
            }
        }
    }

    #[test]
    fn randomised_parity() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let ascii: Vec<u8> = (0..20_000)
            .map(|_| b'0' + rng.gen_range(0..10))
            .collect();
        for chunk_digits in [2usize, 100, 2000] {
            let ds = build_dataset(&ascii, chunk_digits);
            for len in [1usize, 2, 3, 5, 8] {
                let start = rng.gen_range(0..ascii.len() - len);
                let query = &ascii[start..start + len];
                let got = search_exact(&ds, query, 10_000, &ScanControl::default()).unwrap();
                let want = reference_all(&ascii, query);
                assert_eq!(got.total as usize, want.len(), "len {len} chunk {chunk_digits}");
                assert_eq!(got.positions, want);
            }
        }
    }

    #[test]
    fn find_first_matches_full_scan() {
        let ascii = b"99123999123991"; // 14 digits (even)
        let ds = crate::testutil::build_dataset(ascii, 4);
        assert_eq!(find_first(&ds, b"123").unwrap(), 3);
        assert_eq!(find_first(&ds, b"9123").unwrap(), 2);
        assert_eq!(find_first(&ds, b"1123").unwrap(), 0);
        let full = search_exact(&ds, b"123", 10, &ScanControl::default()).unwrap();
        assert_eq!(full.positions[0], find_first(&ds, b"123").unwrap());
    }

    /// Reference: the TS engine's longest-existing-prefix shortening indexOf.
    fn reference_prefix(haystack: &[u8], query: &[u8]) -> Option<(u64, u64)> {
        for len in (1..query.len()).rev() {
            if let Some(idx) = haystack[..]
                .windows(len)
                .position(|w| w == &query[..len])
            {
                return Some((len as u64, idx as u64 + 1));
            }
        }
        None
    }

    #[test]
    fn longest_prefix_parity_with_reference() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(123);
        let ascii: Vec<u8> = (0..6_000)
            .map(|_| b'0' + rng.gen_range(0..4)) // small alphabet → many partial hits
            .collect();
        for chunk_digits in [2usize, 100, 2000] {
            let ds = build_dataset(&ascii, chunk_digits);
            for _ in 0..300 {
                let len = rng.gen_range(2..7);
                let mut query: Vec<u8> = (0..len).map(|_| b'0' + rng.gen_range(0..4)).collect();
                // Only test the absent case (the only time the TS computes it).
                if search_exact(&ds, &query, 1, &ScanControl::default()).unwrap().total > 0 {
                    continue;
                }
                let got = longest_existing_prefix(&ds, &query, &ScanControl::default()).unwrap();
                let want = reference_prefix(&ascii, &query);
                assert_eq!(got, want, "query {:?} chunk {chunk_digits}", query);
                let _ = &mut query;
            }
        }
    }

    #[test]
    fn longest_prefix_known_cases() {
        let ascii = b"991238991238";
        let ds = build_dataset(ascii, 4);
        // "9919" never occurs; "99" occurs at 1 and 7; "991" occurs at 1 and 7;
        // "9912" occurs at 1 and 7. Longest proper prefix = 4? no: "9912" is the
        // full query... use "9912399" (len 7): proper prefixes "991239"(no),
        // "99123"(yes→1), so expect (5, 1).
        let r = longest_existing_prefix(&ds, b"9912399", &ScanControl::default()).unwrap();
        assert_eq!(r, Some((5, 1)));
        // No prefix occurs at all.
        let r = longest_existing_prefix(&ds, b"5555555", &ScanControl::default()).unwrap();
        assert_eq!(r, None);
        // Single-char query: nothing to report.
        let r = longest_existing_prefix(&ds, b"9", &ScanControl::default()).unwrap();
        assert_eq!(r, None);
    }

    #[test]
    fn cap_and_truncation() {
        let ascii: Vec<u8> = b"11".repeat(50);
        let ds = build_dataset(&ascii, 20);
        let r = search_exact(&ds, b"1", 5, &ScanControl::default()).unwrap();
        assert_eq!(r.total, 100);
        assert_eq!(r.positions.len(), 5);
        assert!(r.truncated);
    }
}
