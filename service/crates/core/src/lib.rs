//! π Atlas search core.
//!
//! One canonical dataset, one set of search algorithms, shared by the HTTP
//! service, the benchmark harness and (later) the WebAssembly offline mode.
//!
//! Dataset representation: decimal digits after the point of π, packed two
//! per byte (4 bits each, big nibble = even 0-based index). Chunked, with a
//! manifest carrying per-chunk SHA-256 checksums and dataset metadata.
//! All external positions are 1-based decimal positions; position 1 is the
//! first digit after the decimal point (the dataset never contains a "3."
//! prefix).

pub mod dataset;
pub mod exact;
pub mod letters;
pub mod manifest;
pub mod pack;
pub mod pattern;
pub mod stats;
pub mod window;

/// A loaded, checksum-verified dataset: packed chunks in memory.
pub struct Dataset {
    pub manifest: manifest::Manifest,
    /// Packed digit data. Chunk `c` occupies
    /// `packed[c * packed_chunk_bytes .. (c+1) * packed_chunk_bytes]`
    /// except possibly the last (shortest, still whole bytes — chunk digit
    /// counts are even by construction).
    pub packed: Vec<u8>,
    /// Digit offset of each chunk start (0-based, 0 = first digit after point).
    pub chunk_digit_starts: Vec<u64>,
}

/// Build an in-memory Dataset from ASCII digits (test helper).
#[cfg(test)]
pub(crate) mod testutil {
    use super::*;
    use crate::manifest::{ChunkMeta, Manifest, FORMAT_ID};

    pub fn build_dataset(ascii: &[u8], chunk_digits: usize) -> Dataset {
        assert_eq!(ascii.len() % 2, 0);
        assert_eq!(chunk_digits % 2, 0);
        let mut packed = Vec::new();
        let mut chunks = Vec::new();
        let mut starts = vec![0u64];
        for block in ascii.chunks(chunk_digits) {
            let p = crate::pack::pack_digits(block);
            chunks.push(ChunkMeta {
                digits: block.len() as u64,
                bytes: p.len() as u64,
                sha256: manifest::sha256_hex(&p),
            });
            packed.extend_from_slice(&p);
            starts.push(starts.last().unwrap() + block.len() as u64);
        }
        starts.pop();
        let manifest = Manifest {
            format: FORMAT_ID.to_string(),
            total_digits: ascii.len() as u64,
            chunk_digits: chunk_digits as u64,
            first_digits: String::from_utf8(ascii[..ascii.len().min(64)].to_vec()).unwrap(),
            checkpoints: vec![],
            sha256_packed: manifest::sha256_hex(&packed),
            chunks,
        };
        manifest.validate().unwrap();
        manifest.verify_packed(&packed).unwrap();
        Dataset { manifest, packed, chunk_digit_starts: starts }
    }
}

impl Dataset {
    /// Digits in chunk `c`.
    pub fn chunk_digits(&self, c: usize) -> u64 {
        let next_start = self
            .chunk_digit_starts
            .get(c + 1)
            .copied()
            .unwrap_or(self.manifest.total_digits);
        next_start - self.chunk_digit_starts[c]
    }

    pub fn chunk_count(&self) -> usize {
        self.chunk_digit_starts.len()
    }

    pub fn total_digits(&self) -> u64 {
        self.manifest.total_digits
    }

    /// Digit `i` (0-based). Slow path — tests and diagnostics only.
    pub fn digit(&self, i: u64) -> u8 {
        let chunk_idx = (i / self.manifest.chunk_digits) as usize;
        let within = i % self.manifest.chunk_digits;
        let byte = self.packed
            [(self.chunk_digit_starts[chunk_idx] as usize) / 2 + (within as usize) / 2];
        if within % 2 == 0 { byte >> 4 } else { byte & 0x0f }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("manifest invalid: {0}")]
    Manifest(String),
    #[error("checksum mismatch: {0}")]
    Checksum(String),
    #[error("dataset verification failed: {0}")]
    Verify(String),
}

pub type CoreResult<T> = Result<T, CoreError>;
