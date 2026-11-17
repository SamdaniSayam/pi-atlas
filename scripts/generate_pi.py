#!/usr/bin/env python3
"""
Generate the first N decimal digits of pi.

Strategy:
  1. Compute pi with mpmath at precision P1 = enough digits for N decimals + guard.
  2. Compute pi again at a second, larger precision P2.
  3. Compare the first N decimal digits of both runs. If they differ -> FAIL loudly.
  4. Write exactly N decimal digits (no leading "3", no newline) to the output file.
  5. Write a SHA-256 checksum file alongside.

Note: mpmath's dps->bits rounding can shave a digit or two off the tail of
str(mp.pi), so we request extra guard digits and assert the produced length.
"""
import hashlib
import sys

from mpmath import mp

N = 2_000_000
GUARD = 500  # extra correct digits demanded beyond N


def decimals_at(dps: int) -> str:
    """Return pi's decimal expansion as a string WITHOUT the leading '3'."""
    mp.dps = dps
    pi_str = str(mp.pi)
    assert pi_str.startswith("3."), "unexpected pi formatting"
    decimals = pi_str[2:]
    if len(decimals) < N:
        raise SystemExit(
            f"FAIL: only {len(decimals)} decimals produced at dps={dps}"
        )
    return decimals[:N]


def main() -> None:
    out_path = sys.argv[1] if len(sys.argv) > 1 else "public/pi-2m.txt"
    sha_path = sys.argv[2] if len(sys.argv) > 2 else "public/pi-2m.sha256"

    print(f"Generating {N} decimal digits of pi (dual precision)...")
    a = decimals_at(N + GUARD)
    b = decimals_at(N + 2 * GUARD)

    if a != b:
        raise SystemExit("FAIL: dual-precision digits disagree; refusing to save.")

    print("Dual-precision cross-check passed.")

    known = "14159265358979323846264338327950288419716939937510"
    if a[:50] != known:
        raise SystemExit("FAIL: first 50 digits do not match the known reference.")

    data = a.encode("ascii")
    with open(out_path, "wb") as fh:
        fh.write(data)

    digest = hashlib.sha256(data).hexdigest()
    with open(sha_path, "w", encoding="ascii") as fh:
        fh.write(f"{digest}  {out_path.split('/')[-1]}\n")

    print(f"Wrote {out_path}: {len(data)} bytes")
    print(f"SHA-256: {digest}")


if __name__ == "__main__":
    main()
