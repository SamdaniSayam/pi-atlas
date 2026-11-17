//! Letter search (FR-04): A–Z encoded as digit pairs, matched in both pair
//! alignments over the digit stream.
//!
//! Encoding: letter value v (A=0..Z=25) matches pair values k with k ≡ v
//! (mod 26): pairs "vv", k = v, v+26, v+52, v+78 — so under the uniform model
//! A–V (4 pair-values each) have probability 4/100 and W–Z (3 each) 3/100.
//!
//! Frames:
//!   Frame A: pairs at 0-based digits (0,1), (2,3), …  → pair g spans digits
//!            (2g, 2g+1); a match starting at pair g is at 1-based position
//!            2g + 1.
//!   Frame B: pairs at (1,2), (3,4), …                 → pair g spans digits
//!            (2g+1, 2g+2); match at pair g is at position 2g + 2.
//!
//! This is a faithful streaming port of `src/engine/lettersSearch.ts` — same
//! KMP failure function, same overlapping-match continuation. Chunked with a
//! one-digit carry for frame B's boundary pair and persistent KMP states.

use crate::Dataset;

pub const MATCH_CAP: usize = 200_000;

#[derive(Debug, Clone, serde::Serialize)]
pub struct LetterFrameMatches {
    pub frame: &'static str,
    /// 1-based positions of match starts, ascending, capped.
    pub positions: Vec<u64>,
    pub total: u64,
    pub capped: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LetterResult {
    pub word: String,
    pub frames: [LetterFrameMatches; 2],
    pub total: u64,
    pub incomplete: bool,
}

fn failure(values: &[u8]) -> Vec<usize> {
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

/// KMP matcher over pair values with persistent state (streaming-safe).
struct Kmp {
    values: Vec<u8>,
    f: Vec<usize>,
    s: usize,
}
impl Kmp {
    fn new(values: Vec<u8>) -> Self {
        let f = failure(&values);
        Kmp { values, f, s: 0 }
    }
    /// Feed one pair value; returns true when the pattern just completed.
    fn feed(&mut self, v: u8) -> bool {
        while self.s > 0 && v != self.values[self.s] {
            self.s = self.f[self.s - 1];
        }
        if v == self.values[self.s] {
            self.s += 1;
        }
        if self.s == self.values.len() {
            self.s = self.f[self.s - 1]; // overlapping matches continue
            return true;
        }
        false
    }
}

fn normalize_word(raw: &str) -> String {
    // Mirrors the TS engine's normalizeWord: NFD-fold to A–Z, drop whitespace,
    // cap at 12 letters. The API layer normalizes before calling search_letters;
    // this helper is used for input validation.
    let mut word = String::new();
    for ch in raw.to_uppercase().chars() {
        if ('A'..='Z').contains(&ch) {
            word.push(ch);
        }
        if word.len() >= 12 {
            break;
        }
    }
    word
}

/// Search `word_values` (0-based letter values, A=0) in both frames.
/// Normalization happens client-side before the request; `word` is echoed
/// back as a label.
pub fn search_letters(
    ds: &Dataset,
    word: &str,
    word_values: &[u8],
    position_cap: usize,
    ctl: &crate::exact::ScanControl<'_>,
) -> LetterResult {
    let k = word_values.len();
    let mut matcher_a = Kmp::new(word_values.to_vec());
    let mut matcher_b = Kmp::new(word_values.to_vec());

    let mut frames = [
        LetterFrameMatches { frame: "A", positions: Vec::new(), total: 0, capped: false },
        LetterFrameMatches { frame: "B", positions: Vec::new(), total: 0, capped: false },
    ];
    let mut incomplete = false;

    let mut prev_last_digit: Option<u8> = None; // nibble value
    let mut scratch: Vec<u8> = Vec::new();

    for c in 0..ds.chunk_count() {
        if (ctl.is_cancelled)() || ctl.deadline.map_or(false, |d| std::time::Instant::now() > d) {
            incomplete = true;
            break;
        }
        let chunk_start = ds.chunk_digit_starts[c];
        let chunk_digits = ds.chunk_digits(c);
        let packed_slice = &ds.packed[chunk_start as usize / 2..(chunk_start + chunk_digits) as usize / 2];

        scratch.clear();
        crate::pack::unpack_into(packed_slice, 0, chunk_digits, &mut scratch);

        let first_digit = (scratch[0] - b'0') as u8;

        // Frame B boundary pair: (previous chunk's last digit, this chunk's
        // first digit). Global pair index g = chunk_start/2 - 1.
        if let (Some(prev), true) = (prev_last_digit, c > 0) {
            let g = chunk_start / 2 - 1;
            let v = ((prev * 10 + first_digit) % 26) as u8;
            if matcher_b.feed(v) {
                let start_pair = g + 1 - k as u64; // match begins at this pair
                frames[1].total += 1;
                if frames[1].positions.len() < position_cap {
                    frames[1].positions.push(2 * start_pair + 2);
                } else {
                    frames[1].capped = true;
                }
            }
        }

        // In-chunk pairs. Frame A pair g spans (2j, 2j+1) with j = g - chunk_start/2.
        let pairs_in_chunk = chunk_digits / 2;
        for j in 0..pairs_in_chunk {
            let ju = j as usize;
            let d0 = (scratch[2 * ju] - b'0') as u8;
            let d1 = (scratch[2 * ju + 1] - b'0') as u8;
            let g = chunk_start / 2 + j;

            let v_a = ((d0 * 10 + d1) % 26) as u8;
            if matcher_a.feed(v_a) {
                let start_pair = g + 1 - k as u64;
                frames[0].total += 1;
                if frames[0].positions.len() < position_cap {
                    frames[0].positions.push(2 * start_pair + 1);
                } else {
                    frames[0].capped = true;
                }
            }

            // Frame B in-chunk pair (2g+1, 2g+2) needs digit 2g+2 inside the
            // chunk, i.e. j < pairs_in_chunk - 1; the last one is the next
            // chunk's boundary pair.
            if j + 1 < pairs_in_chunk {
                let d2 = (scratch[2 * ju + 2] - b'0') as u8;
                let v_b = ((d1 * 10 + d2) % 26) as u8;
                if matcher_b.feed(v_b) {
                    let start_pair = g + 1 - k as u64;
                    frames[1].total += 1;
                    if frames[1].positions.len() < position_cap {
                        frames[1].positions.push(2 * start_pair + 2);
                    } else {
                        frames[1].capped = true;
                    }
                }
            }
        }

        prev_last_digit = Some((scratch[scratch.len() - 1] - b'0') as u8);
        if let Some(p) = ctl.on_progress {
            p(chunk_start + chunk_digits, ds.total_digits());
        }
    }

    let total = frames[0].total + frames[1].total;
    LetterResult {
        word: word.to_string(),
        frames,
        total,
        incomplete,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exact::ScanControl;

    /// Reference port of the TS engine's searchWord frame scan (whole-string).
    fn reference_frame(digits: &[u8], values: &[u8], start: usize) -> Vec<u64> {
        let k = values.len();
        let f = failure(values);
        let mut out = Vec::new();
        let mut s = 0usize;
        let mut pair_idx = 0usize;
        let mut i = start;
        while i + 1 < digits.len() {
            let v = ((digits[i] - b'0') * 10 + (digits[i + 1] - b'0')) % 26;
            while s > 0 && v != values[s] {
                s = f[s - 1];
            }
            if v == values[s] {
                s += 1;
            }
            if s == k {
                out.push((start + 2 * (pair_idx - k + 1) + 1) as u64);
                s = f[s - 1];
            }
            i += 2;
            pair_idx += 1;
        }
        out
    }

    fn frame_positions_streamed(ds: &Dataset, values: &[u8], frame: usize) -> (Vec<u64>, u64) {
        let r = search_letters(ds, "W", values, 200_000, &ScanControl::default());
        (r.frames[frame].positions.clone(), r.frames[frame].total)
    }

    fn build_ds(ascii: &[u8], chunk_digits: usize) -> Dataset {
        crate::testutil::build_dataset(ascii, chunk_digits)
    }

    #[test]
    fn parity_with_reference() {
        let ascii = b"010216190501161701021619050116170102161902161901021619".to_vec();
        for chunk_digits in [2usize, 6, 20, 56] {
            let ds = build_ds(&ascii, chunk_digits);
            for word in [&b"PI"[..], &b"AAA"[..], &b"ABCAB"[..], &b"ZZZ"[..], &b"PIPELINE"[..]] {
                let values: Vec<u8> = word.iter().map(|&c| c - b'A').collect();
                for (frame, start) in [(0usize, 0usize), (1usize, 1usize)] {
                    let want = reference_frame(&ascii, &values, start);
                    let (got, total) = frame_positions_streamed(&ds, &values, frame);
                    assert_eq!(got, want, "frame {frame} chunk {chunk_digits}");
                    assert_eq!(total as usize, want.len());
                }
            }
        }
    }
}
