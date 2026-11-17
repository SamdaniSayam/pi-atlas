#!/usr/bin/env python3
"""Generate a browser web manifest from an existing pi-atlas-packed-v1 dataset.

Stage 2. Reads a packed dataset directory (manifest.json + chunks/chunk_NNNNN.bin)
produced by pack_dataset.py and writes a `pi-atlas-web-manifest-v1` descriptor
plus a self-contained static file tree that GitHub Pages can serve as-is.

The packed chunks are copied byte-for-byte (never re-encoded). Every chunk is
re-verified against its SHA-256 before being copied, and the concatenated
whole-file SHA-256 is re-verified against the source manifest.

Usage:
  python3 scripts/make_web_dataset.py \
      --input /path/to/data-1b \
      --output-dir public/dataset/1b \
      --dataset-id pi-1b-2026 \
      --base-url dataset/1b/chunks/

Output:
  <output-dir>/web-manifest.json    (camelCase browser manifest, Stage 2)
  <output-dir>/core-manifest.json   (verbatim source manifest for the WASM PiEngine)
  <output-dir>/chunks/chunk_NNNNN.bin   (byte-identical copies)
"""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

PACK_FORMAT = "pi-atlas-packed-v1"
WEB_VERSION = 1


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="packed dataset directory")
    ap.add_argument("--output-dir", required=True, help="static tree destination")
    ap.add_argument("--dataset-id", required=True, help="stable cache-invalidation id")
    ap.add_argument("--base-url", required=True, help="chunk URL prefix relative to site root")
    ap.add_argument("--no-copy", action="store_true", help="validate and write manifest only")
    args = ap.parse_args()

    src = Path(args.input)
    m = json.loads((src / "manifest.json").read_text())
    if m.get("format") != PACK_FORMAT:
        print(f"unexpected source format: {m.get('format')}", file=sys.stderr)
        return 2

    out = Path(args.output_dir)
    out_chunks = out / "chunks"
    out_chunks.mkdir(parents=True, exist_ok=True)

    base = args.base_url
    if base and not base.endswith("/"):
        base += "/"

    chunks = []
    whole = hashlib.sha256()
    digit_offset = 0
    packed_offset = 0
    for i, meta in enumerate(m["chunks"]):
        name = f"chunk_{i:05d}.bin"
        raw = (src / "chunks" / name).read_bytes()
        if len(raw) != meta["bytes"]:
            print(f"chunk {i}: length {len(raw)} != {meta['bytes']}", file=sys.stderr)
            return 2
        digest = sha256_hex(raw)
        if digest != meta["sha256"]:
            print(f"chunk {i}: sha256 mismatch", file=sys.stderr)
            return 2
        whole.update(raw)
        chunks.append({
            "index": i,
            "file": name,
            "digits": meta["digits"],
            "bytes": meta["bytes"],
            "packedOffset": packed_offset,
            "digitOffset": digit_offset,
            "sha256": digest,
        })
        if not args.no_copy:
            shutil.copyfile(src / "chunks" / name, out_chunks / name)
        digit_offset += meta["digits"]
        packed_offset += meta["bytes"]

    if packed_offset != m["total_digits"] // 2 or digit_offset != m["total_digits"]:
        print("dataset byte/digit totals disagree with manifest", file=sys.stderr)
        return 2
    if whole.hexdigest() != m["sha256_packed"]:
        print("whole-file sha256 mismatch", file=sys.stderr)
        return 2

    web_manifest = {
        "version": WEB_VERSION,
        "format": PACK_FORMAT,
        "datasetId": args.dataset_id,
        "totalDigits": m["total_digits"],
        "chunkDigits": m["chunk_digits"],
        "chunkCount": len(chunks),
        "packedBytes": packed_offset,
        "firstDigits": m["first_digits"],
        "sha256Packed": m["sha256_packed"],
        "baseUrl": base,
        "filenameTemplate": "chunk_{index:05d}.bin",
        "chunks": chunks,
        # The core manifest uses snake_case; the browser manifest is camelCase.
        # Map explicitly so `firstPosition` is never undefined in ManifestInfo.
        "checkpoints": [
            {"query": c["query"], "firstPosition": c["first_position"]}
            for c in m.get("checkpoints", [])
        ],
        "searchIndex": {
            "kind": "none",
            "note": "No persistent index; full searches scan all chunks sequentially.",
        },
    }
    (out / "web-manifest.json").write_text(json.dumps(web_manifest, indent=2) + "\n")
    # The WASM PiEngine consumes the core (snake_case) manifest verbatim — copy
    # the verified source manifest so checksums are identical by construction.
    (out / "core-manifest.json").write_text((src / "manifest.json").read_text())
    print(f"wrote {out / 'web-manifest.json'}: {len(chunks)} chunks, {packed_offset} packed bytes")
    print(f"wrote {out / 'core-manifest.json'}")
    print(f"sha256_packed: {m['sha256_packed']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
