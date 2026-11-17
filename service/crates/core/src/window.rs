//! Digit window extraction for visualization.
//!
//! The API hands out small windows on demand; the browser never holds the
//! dataset. Positions are external (1-based); internally 0-based.

/// Extract ASCII digits for the 1-based inclusive range [start, end]
/// (both 1-based decimal positions). Returns (digits, first_position).
pub fn window_1based(
    ds: &crate::Dataset,
    start: u64,
    end: u64,
) -> Result<Vec<u8>, crate::CoreError> {
    if start == 0 || end < start {
        return Err(crate::CoreError::Verify(format!(
            "invalid window [{start}, {end}] (positions are 1-based)"
        )));
    }
    let s0 = start - 1;
    let e0 = end; // inclusive 1-based end → exclusive 0-based end = e0
    if e0 > ds.total_digits() {
        return Err(crate::CoreError::Verify(format!(
            "window end {end} beyond dataset ({} digits)",
            ds.total_digits()
        )));
    }
    let mut out = Vec::with_capacity((e0 - s0) as usize);
    // Window may start on an odd 0-based index — extract one nibble first.
    let mut pos = s0;
    if pos % 2 == 1 {
        out.push(b'0' + ds.digit(pos));
        pos += 1;
    }
    if pos < e0 {
        let even_count = e0 - pos - ((e0 - pos) % 2);
        if even_count > 0 {
            let mut cur = pos;
            while cur < pos + even_count {
                let chunk_idx = (cur / ds.manifest.chunk_digits) as usize;
                let chunk_start = ds.chunk_digit_starts[chunk_idx];
                let chunk_len = ds.chunk_digits(chunk_idx);
                let within = cur - chunk_start;
                let take = (chunk_len - within).min(pos + even_count - cur);
                let take_even = take - (take % 2);
                if take_even > 0 {
                    let base = (chunk_start / 2 + within / 2) as usize;
                    crate::pack::unpack_into(&ds.packed[base..], 0, take_even, &mut out);
                    cur += take_even;
                }
                if take > take_even {
                    out.push(b'0' + ds.digit(cur));
                    cur += 1;
                }
            }
        }
        if pos + even_count < e0 {
            out.push(b'0' + ds.digit(e0 - 1));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_match_unpacked_stream() {
        let ascii = b"14159265358979323846264338327950288419716939937510";
        let ds = crate::testutil::build_dataset(ascii, 8);
        for start in 1..=ascii.len() {
            for end in start..=ascii.len() {
                let got = window_1based(&ds, start as u64, end as u64).unwrap();
                let want = &ascii[start - 1..end];
                assert_eq!(&got[..], want, "window [{start}, {end}]");
            }
        }
        // 1-based position 1 is the first digit after the point.
        assert_eq!(window_1based(&ds, 1, 1).unwrap(), b"1");
    }

    #[test]
    fn rejects_out_of_range() {
        let ds = crate::testutil::build_dataset(b"12345678", 4);
        assert!(window_1based(&ds, 0, 2).is_err());
        assert!(window_1based(&ds, 1, 9).is_err());
        assert!(window_1based(&ds, 5, 2).is_err());
    }
}
