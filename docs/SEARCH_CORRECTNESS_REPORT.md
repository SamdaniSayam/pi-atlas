# Search correctness report (2026-11-18)

## Scope

The browser-only engine must return the same answers as the reference
implementation on the **real** π digits — not a smaller or synthetic fixture.
Two independent checks cover this: an in-process WASM smoke test and a
reference-comparison parity script.

## Fixture

`public/pi-2m.txt` — 2,000,000 real decimal digits of π, SHA-256
`efcbafbaf15047f32f70d8b1b008bac527e9f76d4d4b995d7f36dfd6dd8dc7ed`.
Verified in CI by `npm run verify:pi`, including an independent mpmath
recomputation at a different precision.

## Results

| Check | Result |
| --- | --- |
| `node scripts/wasm_smoke.cjs` | 12/12 |
| `npm run test:parity` | **100/100 assertions** |
| `npm test` | 99/99 unit/integration |
| `npm run test:e2e` | 48/48 |
| 1B source dataset streaming validation | OK, 1.0 s, 18 MB peak |
| 1B web-tree artifact validation | OK, 1.35 s, 126 MB peak |

Parity assertion distribution: exact 54, letters 8, dates 24, pattern 8,
stats 1, windows 5.

## Semantics verified

- **1-based decimal positions**, no leading `3` in the fixture or results.
- **Overlapping** exact matches (`from = i + 1` in both engine and reference).
- Uncapped `total` plus `truncated`/`incomplete` flags; capped `positions`.
- **Chunk-boundary carry**: queries spanning digit 1,000,000 and 500,000
  match exactly.
- **Letter encoding** `(10*a + b) mod 26` on both pair frames (A and B).
- All six date encodings; `incomplete` derived from actual row state, and
  incomplete results are never cached.
- Pattern geometry at field widths 16 and 97, colour and shape modes.
- Checkpoint `12` → position 148, `999999` → position 762.
- Full digit count/chi-square statistics.
- Window reads with only owning chunks resident; checksum-corrupted chunks
  rejected.

## 1B dataset integrity

`python3 scripts/verify_1b_streaming.py /home/megalith/pi-atlas-build/data-1b`:

- 1,000,000,000 digits, 100 chunks × 10,000,000 digits × 5,000,000 packed bytes.
- Every per-chunk SHA-256 matches the manifest.
- Whole-file SHA-256 matches
  `054944fdbab4a1d839b0afa808955c126c0ee35b794d4181b027b973f7610911`.
- Published first-100 decimals and checkpoints match.

The script hashes in 1 MiB blocks and never concatenates the 500 MB payload,
so peak RSS stays near 18 MB.

The generated web tree at `/home/megalith/pi-atlas-web/1b` passes the same
artifact validator CI uses: 100 chunks, 500,000,000 packed bytes, identical
SHA-256, relative asset paths.

## Known limits

- Reference parity runs on the 2M fixture. The 1B tree is validated for byte
  identity and checksums, not by a full 1B reference scan (that would require
  downloading 477 MiB into the harness and is deliberately avoided).
- Probability/odds figures remain clearly labelled model estimates, not
  measurements.
- Partial searches are labelled via `truncated`/`incomplete`; no partial
  result is presented as complete or cached as the answer.
