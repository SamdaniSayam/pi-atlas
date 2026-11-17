#!/usr/bin/env python3
"""Stage 9: verify the full 1B dataset with bounded memory.

Reads each chunk in 1 MiB blocks, updating a per-chunk SHA-256 and a rolling
whole-file SHA-256 at the same time. Peak RSS stays near 2 MB — unlike any
approach that concatenates the 500 MB of packed chunks before hashing.

Usage: python3 scripts/verify_1b_streaming.py [data-dir]
Default data dir: /home/megalith/pi-atlas-build/data-1b
"""
import hashlib
import json
import os
import sys

BLOCK = 1024 * 1024
DEFAULT_DIR = "/home/megalith/pi-atlas-build/data-1b"


def main() -> int:
    root = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DIR
    with open(os.path.join(root, "manifest.json"), "r", encoding="utf-8") as fh:
        m = json.load(fh)

    assert m["format"] == "pi-atlas-packed-v1", "bad format id"
    assert m["total_digits"] == 1_000_000_000, "bad total_digits"
    chunks = m["chunks"]
    assert len(chunks) == 100, "bad chunk count"
    assert m["chunk_digits"] == 10_000_000, "bad chunk_digits"
    assert all(c["digits"] == 10_000_000 and c["bytes"] == 5_000_000 for c in chunks)

    whole = hashlib.sha256()
    total_bytes = 0
    for i, meta in enumerate(chunks):
        path = os.path.join(root, "chunks", "chunk_%05d.bin" % i)
        chunk_hash = hashlib.sha256()
        chunk_bytes = 0
        with open(path, "rb") as fh:
            while True:
                block = fh.read(BLOCK)
                if not block:
                    break
                chunk_hash.update(block)
                whole.update(block)
                chunk_bytes += len(block)
        if chunk_bytes != meta["bytes"]:
            print("FAIL chunk %d: %d bytes != %d" % (i, chunk_bytes, meta["bytes"]))
            return 1
        got = chunk_hash.hexdigest()
        if got != meta["sha256"]:
            print("FAIL chunk %d sha256: %s != %s" % (i, got, meta["sha256"]))
            return 1
        total_bytes += chunk_bytes
        if (i + 1) % 25 == 0:
            print("  verified %d/100 chunks" % (i + 1), flush=True)

    if total_bytes != m["total_digits"] // 2:
        print("FAIL packed bytes %d != %d" % (total_bytes, m["total_digits"] // 2))
        return 1
    got_whole = whole.hexdigest()
    if got_whole != m["sha256_packed"]:
        print("FAIL whole sha256: %s != %s" % (got_whole, m["sha256_packed"]))
        return 1

    # Checkpoints live in the first 1000 digits; read only 500 packed bytes.
    with open(os.path.join(root, "chunks", "chunk_00000.bin"), "rb") as fh:
        head = fh.read(500)
    digits = "".join("%d%d" % (b >> 4, b & 15) for b in head)
    # first_digits is a short prefix (64 digits in the 1B manifest), so compare
    # exactly its length rather than assuming 1000.
    prefix_len = len(m["first_digits"])
    if digits[:prefix_len] != m["first_digits"]:
        print("FAIL first %d digits mismatch" % prefix_len)
        return 1
    published_100 = (
        "14159265358979323846264338327950288419716939937510"
        "58209749445923078164062862089986280348253421170679"
    )
    if digits[:100] != published_100:
        print("FAIL published first 100 decimals mismatch")
        return 1
    for needle, pos in (("12", 148), ("999999", 762)):
        found = digits.find(needle) + 1
        if found != pos:
            print("FAIL checkpoint %s: first at %d, expected %d" % (needle, found, pos))
            return 1

    print("1B streaming validation OK: %d digits, %d chunks, %d packed bytes, sha %s"
          % (m["total_digits"], len(chunks), total_bytes, got_whole))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
