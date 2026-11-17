//! Dataset manifest: metadata, checksums and verification.
//!
//! The manifest is the integrity contract between the packing script, the
//! search service and any offline (WASM) client:
//!
//! ```json
//! {
//!   "format": "pi-atlas-packed-v1",
//!   "total_digits": 2000000,
//!   "chunk_digits": 1000000,
//!   "first_digits": "14159265358979...",
//!   "checkpoints": [{ "query": "12", "first_position": 148 }],
//!   "sha256_packed": "<sha256 of the concatenated packed chunks>",
//!   "chunks": [{ "digits": 1000000, "bytes": 500000, "sha256": "..." }]
//! }
//! ```

use crate::CoreError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const FORMAT_ID: &str = "pi-atlas-packed-v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkMeta {
    /// Number of decimal digits in this chunk (even).
    pub digits: u64,
    /// Packed byte length (= digits / 2).
    pub bytes: u64,
    /// SHA-256 of the packed chunk bytes.
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub query: String,
    /// 1-based decimal position of the first occurrence.
    pub first_position: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub format: String,
    pub total_digits: u64,
    pub chunk_digits: u64,
    /// First 64 digits of the stored sequence (after the point).
    pub first_digits: String,
    /// Verified checkpoints, 1-based positions.
    pub checkpoints: Vec<Checkpoint>,
    /// SHA-256 over all packed chunk bytes concatenated.
    pub sha256_packed: String,
    pub chunks: Vec<ChunkMeta>,
}

pub fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    let d = h.finalize();
    d.iter().map(|b| format!("{b:02x}")).collect()
}

impl Manifest {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.format != FORMAT_ID {
            return Err(CoreError::Manifest(format!(
                "unknown format id {:?} (expected {FORMAT_ID:?})",
                self.format
            )));
        }
        if self.total_digits == 0 || self.chunk_digits == 0 {
            return Err(CoreError::Manifest("zero sizes".into()));
        }
        if self.chunk_digits % 2 != 0 || self.total_digits % 2 != 0 {
            return Err(CoreError::Manifest("digit counts must be even".into()));
        }
        let expected_chunks = self.total_digits.div_ceil(self.chunk_digits) as usize;
        if self.chunks.len() != expected_chunks {
            return Err(CoreError::Manifest(format!(
                "chunk count {} != expected {expected_chunks}",
                self.chunks.len()
            )));
        }
        let sum: u64 = self.chunks.iter().map(|c| c.digits).sum();
        if sum != self.total_digits {
            return Err(CoreError::Manifest(format!(
                "chunk digit sum {sum} != total {}",
                self.total_digits
            )));
        }
        if self.first_digits.len() > self.total_digits as usize {
            return Err(CoreError::Manifest("first_digits overlong".into()));
        }
        Ok(())
    }

    /// Verify chunk checksums, whole-file checksum and the first digits.
    pub fn verify_packed(&self, packed: &[u8]) -> Result<(), CoreError> {
        let mut offset = 0usize;
        for (i, meta) in self.chunks.iter().enumerate() {
            let len = meta.bytes as usize;
            let Some(chunk) = packed.get(offset..offset + len) else {
                return Err(CoreError::Checksum(format!(
                    "chunk {i} out of bounds (need {len} bytes at {offset})"
                )));
            };
            let got = sha256_hex(chunk);
            if got != meta.sha256 {
                return Err(CoreError::Checksum(format!(
                    "chunk {i} sha256 mismatch (expected {}, got {got})",
                    meta.sha256
                )));
            }
            offset += len;
        }
        if offset != packed.len() {
            return Err(CoreError::Verify(format!(
                "packed length {} != sum of chunks {offset}",
                packed.len()
            )));
        }
        let whole = sha256_hex(packed);
        if whole != self.sha256_packed {
            return Err(CoreError::Checksum(format!(
                "whole-file sha256 mismatch (expected {}, got {whole})",
                self.sha256_packed
            )));
        }
        let head = crate::pack::unpack_all(&packed[..(self.first_digits.len() + 1) / 2]);
        if !head.starts_with(self.first_digits.as_bytes()) {
            return Err(CoreError::Verify("leading digits mismatch".into()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_manifest() -> Manifest {
        Manifest {
            format: FORMAT_ID.to_string(),
            total_digits: 14,
            chunk_digits: 14,
            first_digits: "14159265358979".to_string(),
            checkpoints: vec![Checkpoint { query: "12".into(), first_position: 148 }],
            sha256_packed: String::new(),
            chunks: vec![ChunkMeta {
                digits: 14,
                bytes: 7,
                sha256: String::new(),
            }],
        }
    }

    #[test]
    fn validates_good_manifest() {
        let ascii = b"14159265358979";
        let packed = crate::pack::pack_digits(ascii);
        let m = Manifest {
            sha256_packed: sha256_hex(&packed),
            chunks: vec![ChunkMeta { digits: 14, bytes: 7, sha256: sha256_hex(&packed) }],
            ..sample_manifest()
        };
        m.validate().unwrap();
        m.verify_packed(&packed).unwrap();
    }

    #[test]
    fn detects_corruption() {
        let ascii = b"14159265358979";
        let mut packed = crate::pack::pack_digits(ascii);
        let m = Manifest {
            sha256_packed: sha256_hex(&packed),
            chunks: vec![ChunkMeta { digits: 14, bytes: 7, sha256: sha256_hex(&packed) }],
            ..sample_manifest()
        };
        packed[3] ^= 0x01;
        assert!(m.verify_packed(&packed).is_err());
    }

    #[test]
    fn rejects_bad_chunk_count() {
        let mut m = sample_manifest();
        m.chunks.push(ChunkMeta { digits: 10, bytes: 5, sha256: String::new() });
        assert!(m.validate().is_err());
    }
}
