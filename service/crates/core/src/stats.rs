/// Digit frequency statistics over the packed dataset (Big Question panel).
/// Counted once over all chunks, cached by the server.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DigitStats {
    /// Count of each digit 0-9 over the whole dataset.
    pub counts: [u64; 10],
    pub total_digits: u64,
    /// Chi-square statistic, 9 degrees of freedom, vs uniform expectation.
    pub chi_square: f64,
}

pub fn compute_stats(ds: &crate::Dataset, ctl: Option<&crate::exact::ScanControl<'_>>) -> crate::CoreResult<DigitStats> {
    let mut counts = [0u64; 10];
    let chunk_digits = ds.manifest.chunk_digits;
    let mut scratch: Vec<u8> = Vec::with_capacity(chunk_digits as usize);
    for c in 0..ds.chunk_count() {
        if let Some(ctl) = ctl {
            if (ctl.is_cancelled)() {
                return Err(crate::CoreError::Verify("cancelled".into()));
            }
        }
        let chunk_start = ds.chunk_digit_starts[c];
        let n = ds.chunk_digits(c);
        let packed = &ds.packed[chunk_start as usize / 2..(chunk_start + n) as usize / 2];
        scratch.clear();
        crate::pack::unpack_into(packed, 0, n, &mut scratch);
        for &b in &scratch {
            counts[(b - b'0') as usize] += 1;
        }
    }
    let total: u64 = counts.iter().sum();
    let expected = total as f64 / 10.0;
    let chi_square: f64 = counts.iter().map(|&c| (c as f64 - expected).powi(2) / expected).sum();
    Ok(DigitStats { counts, total_digits: total, chi_square })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniform_data_has_low_chi_square() {
        let ascii: Vec<u8> = (0..10)
            .flat_map(|d| std::iter::repeat(b'0' + d).take(10))
            .collect();
        let ds = crate::testutil::build_dataset(&ascii, 40);
        let s = compute_stats(&ds, None).unwrap();
        assert_eq!(s.total_digits, 100);
        assert!(s.chi_square < 1e-9, "perfectly uniform data: {}", s.chi_square);
        assert_eq!(s.counts[3], 10);
    }
}
