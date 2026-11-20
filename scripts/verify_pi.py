#!/usr/bin/env python3
"""
Independent verification of the generated pi digit file.

Checks:
  1. Exact byte length == N (no newline, no trailing junk).
  2. Every character is an ASCII digit 0-9.
  3. SHA-256 checksum matches the .sha256 sidecar.
  4. First 100 decimals match the published reference.
  5. Known checkpoints: "12" first occurs at decimal position 148 (1-based),
     "999999" first occurs at decimal position 762 (1-based).
  6. Independent recomputation of pi at a different precision than generation,
     confirming the stored digits against a fresh mpmath run.

Exit code 0 = all checks pass; anything else fails loudly.
"""
import hashlib
import re
import sys

from mpmath import mp

if sys.flags.optimize:
    raise SystemExit("FAIL: this verifier depends on assertions; do not run with python -O")

N = 2_000_000

FIRST_100 = (
    "14159265358979323846264338327950288419716939937510"
    "58209749445923078164062862089986280348253421170679"
)


def main() -> None:
    data_path = sys.argv[1] if len(sys.argv) > 1 else "public/pi-2m.txt"
    sha_path = sys.argv[2] if len(sys.argv) > 2 else "public/pi-2m.sha256"

    data = open(data_path, "rb").read()

    # 1. Length
    assert len(data) == N, f"FAIL length: {len(data)} != {N}"
    print(f"OK  length = {len(data)}")

    # 2. Character set
    assert re.fullmatch(rb"[0-9]+", data), "FAIL charset: non-digit bytes present"
    print("OK  charset: digits 0-9 only")

    # 3. Checksum
    digest = hashlib.sha256(data).hexdigest()
    sidecar = open(sha_path, "r", encoding="ascii").read()
    recorded = sidecar.split()[0].strip().lower()
    assert digest == recorded, f"FAIL sha256: {digest} != {recorded}"
    print(f"OK  sha256 = {digest}")

    text = data.decode("ascii")

    # 4. First 100 decimals
    assert text[:100] == FIRST_100, "FAIL first 100 decimals mismatch"
    print("OK  first 100 decimals")

    # 5. Known checkpoints (1-based decimal positions)
    p12 = text.find("12") + 1
    assert p12 == 148, f"FAIL checkpoint '12': position {p12} != 148"
    p999999 = text.find("999999") + 1
    assert p999999 == 762, f"FAIL checkpoint '999999': position {p999999} != 762"
    print(f"OK  checkpoint '12'     first at decimal position {p12}")
    print(f"OK  checkpoint '999999' first at decimal position {p999999}")

    # 6. Independent recomputation at a third precision.
    #    mpmath's dps->bits rounding can shave a digit or two off str(mp.pi),
    #    so request N + 500 and assert we actually got at least N decimals back.
    mp.dps = N + 500
    fresh_all = str(mp.pi)[2:]
    assert len(fresh_all) >= N, (
        f"FAIL recomputation produced only {len(fresh_all)} decimals"
    )
    fresh = fresh_all[:N]
    assert fresh == text, "FAIL independent recomputation mismatch"
    print(f"OK  independent recomputation (dps = N + 500, {len(fresh_all)} decimals) matches file")

    print("ALL VERIFICATION CHECKS PASSED")


if __name__ == "__main__":
    main()
