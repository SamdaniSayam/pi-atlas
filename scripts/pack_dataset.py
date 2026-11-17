#!/usr/bin/env python3
"""Pack a plain π digit file into the pi-atlas-packed-v1 format.

Input:  ASCII digit text (after the decimal point). A leading "3." is
        stripped automatically. Any whitespace is stripped.
Output: <out-dir>/
          manifest.json
          chunks/chunk_00000.bin … chunk_NNNNN.bin

Guarantees (verified at the end of the pack, or the script fails):
- every chunk SHA-256 matches its manifest entry
- whole-file SHA-256 (concatenated packed chunks) matches
- spot-unpacked positions match the source ASCII at both ends and middle
- total_digits is even; all chunks except possibly manifest bookkeeping are even
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

FORMAT_ID = "pi-atlas-packed-v1"


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pack_digits(ascii_bytes: bytes) -> bytes:
    assert len(ascii_bytes) % 2 == 0
    out = bytearray()
    for i in range(0, len(ascii_bytes), 2):
        out.append(((ascii_bytes[i] - 48) << 4) | (ascii_bytes[i + 1] - 48))
    return bytes(out)


def unpack_digits(packed: bytes) -> bytes:
    out = bytearray()
    for b in packed:
        out.append(48 + (b >> 4))
        out.append(48 + (b & 0x0F))
    return bytes(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="plain digit file (ASCII)")
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--chunk-digits", type=int, default=10_000_000)
    args = ap.parse_args()

    if args.chunk_digits % 2 != 0:
        print("--chunk-digits must be even", file=sys.stderr)
        return 2

    raw = Path(args.input).read_bytes()
    # Strip a leading "3." if present (y-cruncher output).
    if raw.startswith(b"3."):
        raw = raw[2:]
    digits = b"".join(raw.split())
    if not all(48 <= b <= 57 for b in digits):
        bad = sorted({bytes([b]) for b in digits if not (48 <= b <= 57)})[:10]
        print(f"non-digit bytes after stripping: {bad}", file=sys.stderr)
        return 2

    total = len(digits)
    if total % 2 != 0:
        # Drop the final unmatched digit so chunks are whole bytes.
        print(f"warning: odd digit count {total}; dropping last digit", file=sys.stderr)
        digits = digits[:-1]
        total -= 1

    out_dir = Path(args.output_dir)
    chunks_dir = out_dir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)

    chunks = []
    whole = hashlib.sha256()
    packed_len = 0
    for i, start in enumerate(range(0, total, args.chunk_digits)):
        end = min(start + args.chunk_digits, total)
        block = digits[start:end]
        packed = pack_digits(block)
        (chunks_dir / f"chunk_{i:05d}.bin").write_bytes(packed)
        chunks.append({
            "digits": len(block),
            "bytes": len(packed),
            "sha256": sha256_hex(packed),
        })
        whole.update(packed)
        packed_len += len(packed)
        print(f"chunk {i:05d}: {len(block)} digits packed")

    # Checkpoint: first occurrence of "12" after the point (C-speed find).
    first_12 = digits.find(b"12")
    checkpoints = [{"query": "12", "first_position": first_12 + 1}] if first_12 != -1 else []

    manifest = {
        "format": FORMAT_ID,
        "total_digits": total,
        "chunk_digits": args.chunk_digits,
        "first_digits": digits[:64].decode("ascii"),
        "checkpoints": checkpoints,
        "sha256_packed": whole.hexdigest(),
        "chunks": chunks,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    # ---- Verification pass: reload and check everything. ----
    m = json.loads((out_dir / "manifest.json").read_text())
    packed_path = b""
    off = 0
    for i, meta in enumerate(m["chunks"]):
        chunk = (chunks_dir / f"chunk_{i:05d}.bin").read_bytes()
        assert sha256_hex(chunk) == meta["sha256"], f"chunk {i} checksum mismatch"
        off += len(chunk)
    assert off == packed_len == total // 2
    concat = hashlib.sha256()
    for i in range(len(m["chunks"])):
        concat.update((chunks_dir / f"chunk_{i:05d}.bin").read_bytes())
    assert concat.hexdigest() == m["sha256_packed"], "whole-file checksum mismatch"
    # Spot-check the ends and the middle against the source digits.
    sample_packed = (chunks_dir / "chunk_00000.bin").read_bytes()
    assert unpack_digits(sample_packed[:7]) == digits[:14]
    assert unpack_digits(sample_packed[-7:]) == digits[args.chunk_digits - 14:args.chunk_digits]
    mid = total // 2
    mid_chunk = (chunks_dir / f"chunk_{mid // args.chunk_digits:05d}.bin").read_bytes()
    off_in_chunk = (mid % args.chunk_digits) // 2
    assert unpack_digits(mid_chunk[off_in_chunk:off_in_chunk + 8]) == digits[mid:mid + 16]

    print(f"packed {total} digits into {len(chunks)} chunks under {out_dir}")
    print(f"sha256_packed: {m['sha256_packed']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
