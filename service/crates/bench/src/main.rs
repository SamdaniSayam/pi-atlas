//! π Atlas search-engine benchmark: FM-index vs streaming scan.
//!
//! Measures, per scale (2M / 10M / 100M / 1B digits):
//! - construction time + peak RAM + index size (FM-index only)
//! - query latency and count accuracy for a fixed pattern set
//! - position parity between the two engines
//! - window retrieval cost (identical packed-data path for both)
//! - concurrent query throughput
//!
//! Output: one JSON object on stdout.

use std::fs;
use std::io::Write;
use std::sync::Arc;
use std::time::Instant;

use fm_index::{FMIndexWithLocate, MatchWithLocate, Search, SearchIndex, Text};
use pi_core::dataset::load_dataset;
use pi_core::exact::{search_exact, ScanControl};
use pi_core::manifest::{ChunkMeta, Manifest, FORMAT_ID};
use pi_core::pack::pack_digits;
use pi_core::window::window_1based;
use pi_core::Dataset;

const PATTERNS: [&str; 5] = ["12", "123456", "999999", "141592653", "2718281828"];

fn vm_hwm_kb() -> u64 {
    let s = fs::read_to_string("/proc/self/status").unwrap_or_default();
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix("VmHWM:") {
            return rest
                .trim()
                .split_whitespace()
                .next()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
        }
    }
    0
}

/// Build an in-memory Dataset from ASCII digits (same layout as the packer).
fn build_dataset(ascii: &[u8], chunk_digits: usize) -> Dataset {
    let mut data = ascii.to_vec();
    if data.len() % 2 == 1 {
        data.pop();
    }
    let mut chunk_vecs: Vec<Vec<u8>> = Vec::new();
    let mut chunks = Vec::new();
    let mut starts = vec![0u64];
    for block in data.chunks(chunk_digits) {
        let p = pack_digits(block);
        chunks.push(ChunkMeta {
            digits: block.len() as u64,
            bytes: p.len() as u64,
            sha256: pi_core::manifest::sha256_hex(&p),
        });
        chunk_vecs.push(p);
        starts.push(starts.last().unwrap() + block.len() as u64);
    }
    starts.pop();
    let concatenated: Vec<u8> = chunk_vecs.iter().flatten().copied().collect();
    let manifest = Manifest {
        format: FORMAT_ID.to_string(),
        total_digits: data.len() as u64,
        chunk_digits: chunk_digits as u64,
        first_digits: String::from_utf8(data[..data.len().min(64)].to_vec()).unwrap(),
        checkpoints: vec![],
        sha256_packed: pi_core::manifest::sha256_hex(&concatenated),
        chunks,
    };
    manifest.validate().unwrap();
    manifest.verify_packed(&concatenated).unwrap();
    Dataset { manifest, chunks: chunk_vecs, chunk_digit_starts: starts }
}

/// ASCII digit bytes → 1..=10 (leaves 0 exclusive for the terminator).
fn to_values(ascii: &[u8]) -> Vec<u8> {
    ascii.iter().map(|&b| b - b'0' + 1).collect()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut digits_file = String::new();
    let mut scale: usize = 0; // 0 = whole file
    let mut chunk_digits: usize = 1_000_000;
    let mut fm_level: usize = 2;
    let mut run_fm = true;
    let mut run_streaming = true;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--digits" => {
                digits_file = args[i + 1].clone();
                i += 2;
            }
            "--scale" => {
                scale = args[i + 1].parse().unwrap();
                i += 2;
            }
            "--chunk-digits" => {
                chunk_digits = args[i + 1].parse().unwrap();
                i += 2;
            }
            "--fm-level" => {
                fm_level = args[i + 1].parse().unwrap();
                i += 2;
            }
            "--streaming-only" => {
                run_fm = false;
                i += 1;
            }
            "--fm-only" => {
                run_streaming = false;
                i += 1;
            }
            other => panic!("unknown arg {other}"),
        }
    }
    assert!(!digits_file.is_empty(), "--digits FILE required");

    let raw = fs::read(&digits_file).unwrap_or_else(|e| panic!("read {}: {e}", digits_file));
    let all = if raw.starts_with(b"3.") { &raw[2..] } else { &raw[..] };
    let digits: &[u8] = if scale == 0 || scale >= all.len() { all } else { &all[..scale] };
    let n = digits.len();

    let hwm0 = vm_hwm_kb();
    let mut report = serde_json::json!({
        "scale_digits": n,
        "chunk_digits": chunk_digits,
        "vm_hwm_start_kb": hwm0,
    });

    // ---------------- streaming engine ----------------
    if run_streaming {
        let t0 = Instant::now();
        let ds = build_dataset(digits, chunk_digits);
        let build_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let ds = Arc::new(ds);
        let hwm_after_build = vm_hwm_kb();

        let mut queries = Vec::new();
        for p in PATTERNS {
            let t = Instant::now();
            let r = search_exact(&ds, p.as_bytes(), 1000, &ScanControl::default()).unwrap();
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            queries.push(serde_json::json!({
                "pattern": p,
                "count_ms": round3(ms),
                "total": r.total,
                "positions": r.positions,
            }));
        }

        // Window retrieval around the first match of "999999".
        let r = search_exact(&ds, b"999999", 1, &ScanControl::default()).unwrap();
        let win_ms = if r.total > 0 {
            let pos = r.positions[0];
            let t = Instant::now();
            let w = window_1based(&ds, pos.saturating_sub(50).max(1), pos + 99).unwrap();
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            assert_eq!(w.len(), 150);
            round3(ms)
        } else {
            -1.0
        };

        // Concurrency: 4 threads × 25 count queries.
        let conc_ms = {
            let t = Instant::now();
            std::thread::scope(|s| {
                let handles: Vec<_> = (0..4)
                    .map(|_| {
                        let ds = Arc::clone(&ds);
                        s.spawn(move || {
                            for _ in 0..25 {
                                let r = search_exact(&ds, b"999999", 1, &ScanControl::default()).unwrap();
                                std::hint::black_box(r.total);
                            }
                        })
                    })
                    .collect();
                for h in handles {
                    h.join().unwrap();
                }
            });
            t.elapsed().as_secs_f64() * 1000.0
        };

        report["streaming"] = serde_json::json!({
            "build_ms": round3(build_ms),
            "vm_hwm_after_build_kb": hwm_after_build,
            "queries": queries,
            "window_150_ms": win_ms,
            "concurrency_4x25_ms": round3(conc_ms),
        });
    }

    // ---------------- FM-index engine ----------------
    if run_fm {
        // The crate requires the text to end with exactly one zero character;
        // mapping digits 1..=10 keeps 0 exclusive to the terminator. This also
        // dodges a reproducible SA-IS panic in fm-index 0.3.1 on raw 0..9 input.
        let mut values = to_values(digits);
        values.push(0);
        let t0 = Instant::now();
        let text = Text::with_max_character(&values, 10);
        let index = FMIndexWithLocate::new(&text, fm_level).unwrap();
        let build_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let heap_bytes = index.heap_size();
        let hwm_after_build = vm_hwm_kb();

        let mut queries = Vec::new();
        for p in PATTERNS {
            let pat: Vec<u8> = p.bytes().map(|b| b - b'0' + 1).collect();
            let t = Instant::now();
            let count = index.search(&pat).count();
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            queries.push(serde_json::json!({
                "pattern": p,
                "count_ms": round3(ms),
                "total": count,
            }));
        }

        // Locate parity: ALL positions of "999999" (rare pattern), sorted.
        const PROBE: &[u8] = b"999999";
        let pat: Vec<u8> = PROBE.iter().map(|&b| b - b'0' + 1).collect();
        let mut locate_positions: Vec<u64> = index
            .search(&pat)
            .iter_matches()
            .map(|m| m.locate() as u64 + 1) // 1-based
            .collect();
        locate_positions.sort_unstable();

        // Concurrency: 4 threads × 25 count queries.
        let conc_ms = {
            let idx = Arc::new(index);
            let t = Instant::now();
            std::thread::scope(|s| {
                let handles: Vec<_> = (0..4)
                    .map(|_| {
                        let idx = Arc::clone(&idx);
                        let pat = pat.clone();
                        s.spawn(move || {
                            for _ in 0..25 {
                                let c = idx.search(&pat).count();
                                std::hint::black_box(c);
                            }
                        })
                    })
                    .collect();
                for h in handles {
                    h.join().unwrap();
                }
            });
            t.elapsed().as_secs_f64() * 1000.0
        };

        report["fm_index"] = serde_json::json!({
            "level": fm_level,
            "build_ms": round3(build_ms),
            "heap_bytes": heap_bytes,
            "bytes_per_digit": round6(heap_bytes as f64 / n as f64),
            "vm_hwm_after_build_kb": hwm_after_build,
            "queries": queries,
            "locate_positions_sorted": locate_positions,
            "concurrency_4x25_ms": round3(conc_ms),
        });
    }

    // Cross-engine count parity (both ran).
    if run_streaming && run_fm {
        let s = &report["streaming"]["queries"];
        let f = &report["fm_index"]["queries"];
        let mut parity = Vec::new();
        for (a, b) in s.as_array().unwrap().iter().zip(f.as_array().unwrap()) {
            parity.push(a["pattern"] == b["pattern"] && a["total"] == b["total"]);
        }
        report["count_parity"] = serde_json::json!(parity.iter().all(|x| *x));
        // Locate parity against streaming positions (index 2 = "999999").
        let stream_positions = report["streaming"]["queries"][2]["positions"].clone();
        report["locate_parity"] = serde_json::json!(
            stream_positions == report["fm_index"]["locate_positions_sorted"]
        );
    }

    let out = serde_json::to_string_pretty(&report).unwrap();
    let mut stdout = fs::File::create("/dev/stdout").unwrap();
    stdout.write_all(out.as_bytes()).unwrap();
}

fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}
fn round6(x: f64) -> f64 {
    (x * 1_000_000.0).round() / 1_000_000.0
}

/// Load a packed dataset from disk (used by later stages; kept here for parity
/// with the server's load path).
#[allow(dead_code)]
fn load_from_disk(dir: &str) -> Dataset {
    load_dataset(std::path::Path::new(dir)).unwrap()
}
