//! Loading a dataset directory: `manifest.json` + `chunks/chunk_NNNNN.bin`.
//!
//! Directory layout (produced by scripts/pack_dataset.py):
//! ```text
//! <data-dir>/
//!   manifest.json
//!   chunks/chunk_00000.bin ... chunk_NNNNN.bin
//! ```
//! Every chunk's SHA-256 is verified during load; the whole-file SHA-256 is
//! verified by streaming each chunk into a Sha256 hasher. No concatenated copy
//! of the dataset is ever allocated — for the 1B set that would double peak RSS
//! to >1 GB and trip the systemd `MemoryMax=1G` limit.

use crate::manifest::{Manifest, FORMAT_ID};
use crate::{CoreError, Dataset};
use sha2::{Digest, Sha256};
use std::path::Path;

pub fn load_manifest(data_dir: &Path) -> Result<Manifest, CoreError> {
    let path = data_dir.join("manifest.json");
    let raw = std::fs::read(&path)
        .map_err(|e| CoreError::Manifest(format!("cannot read {}: {e}", path.display())))?;
    let m: Manifest = serde_json::from_slice(&raw)
        .map_err(|e| CoreError::Manifest(format!("cannot parse {}: {e}", path.display())))?;
    m.validate()?;
    Ok(m)
}

pub fn load_dataset(data_dir: &Path) -> Result<Dataset, CoreError> {
    let manifest = load_manifest(data_dir)?;
    if manifest.format != FORMAT_ID {
        return Err(CoreError::Manifest(format!("unsupported format {}", manifest.format)));
    }
    let chunks_dir = data_dir.join("chunks");
    let mut chunk_vecs: Vec<Vec<u8>> = Vec::with_capacity(manifest.chunks.len());
    // Stream the whole-file hash while reading. The previous implementation
    // collected a second ~500 MB `concatenated` buffer purely to hash it,
    // making the 1B dataset impossible to load under a 1 GB memory cap.
    let mut whole_hasher = Sha256::new();
    for (i, meta) in manifest.chunks.iter().enumerate() {
        let path = chunks_dir.join(format!("chunk_{i:05}.bin"));
        let bytes = std::fs::read(&path)
            .map_err(|e| CoreError::Checksum(format!("cannot read {}: {e}", path.display())))?;
        if bytes.len() != meta.bytes as usize {
            return Err(CoreError::Checksum(format!(
                "chunk {i}: expected {} bytes, file has {}",
                meta.bytes,
                bytes.len()
            )));
        }
        let got = crate::manifest::sha256_hex(&bytes);
        if got != meta.sha256 {
            return Err(CoreError::Checksum(format!(
                "chunk {i}: sha256 mismatch (expected {}, got {got})",
                meta.sha256
            )));
        }
        whole_hasher.update(&bytes);
        chunk_vecs.push(bytes);
    }
    let whole_hex = format!("{:x}", whole_hasher.finalize());
    if whole_hex != manifest.sha256_packed {
        return Err(CoreError::Checksum(format!(
            "whole-file sha256 mismatch (expected {}, got {whole_hex})",
            manifest.sha256_packed
        )));
    }

    let mut chunk_digit_starts = Vec::with_capacity(manifest.chunks.len());
    let mut acc = 0u64;
    for meta in &manifest.chunks {
        chunk_digit_starts.push(acc);
        acc += meta.digits;
    }
    Ok(Dataset { manifest, chunks: chunk_vecs, chunk_digit_starts })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_through_disk() {
        let dir = std::env::temp_dir().join(format!("pi-core-test-{}", std::process::id()));
        let chunks_dir = dir.join("chunks");
        std::fs::create_dir_all(&chunks_dir).unwrap();
        let ascii = b"141592653589793238462643383279502884"; // 36 digits
        let chunk_digits = 8;
        let mut chunks = Vec::new();
        for (i, block) in ascii.chunks(chunk_digits).enumerate() {
            let p = crate::pack::pack_digits(block);
            let sha = crate::manifest::sha256_hex(&p);
            std::fs::write(chunks_dir.join(format!("chunk_{i:05}.bin")), &p).unwrap();
            chunks.push(crate::manifest::ChunkMeta {
                digits: block.len() as u64,
                bytes: p.len() as u64,
                sha256: sha,
            });
        }
        let manifest = Manifest {
            format: FORMAT_ID.to_string(),
            total_digits: ascii.len() as u64,
            chunk_digits: chunk_digits as u64,
            first_digits: "14159265358979".into(),
            checkpoints: vec![],
            sha256_packed: {
                // whole-file hash over concatenated chunks
                let mut all = Vec::new();
                for block in ascii.chunks(chunk_digits) {
                    all.extend_from_slice(&crate::pack::pack_digits(block));
                }
                crate::manifest::sha256_hex(&all)
            },
            chunks,
        };
        std::fs::write(
            dir.join("manifest.json"),
            serde_json::to_string(&manifest).unwrap(),
        )
        .unwrap();

        let ds = load_dataset(&dir).unwrap();
        assert_eq!(ds.total_digits(), ascii.len() as u64);
        assert_eq!(crate::pattern::unpack_dataset_ascii(&ds), ascii.to_vec());
        assert!(load_dataset(&dir.join("nonexistent")).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
