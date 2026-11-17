# Browser performance report (2026-11-18)

## Build output

`npm run build` (Vite 6, Tailwind 4, React 18, React Router 7) — 2.60 s:

| Asset | Raw | Gzip |
| --- | --- | --- |
| index (framework) | 219.71 kB | 71.33 kB |
| Home | 128.48 kB | 42.64 kB |
| Explore | 79.07 kB | 24.12 kB |
| WASM binary | 231.78 kB | 85.87 kB |
| CSS | 25.22 kB | 6.30 kB |
| searchWorker | 18.49 kB | — |
| TourStage | 14.38 kB | 5.05 kB |

Routes are code-split; the WASM module and worker are loaded only by the search
path, not on first paint. Tailwind 4 kept the stylesheet near its previous
size (~25 kB raw).

## Runtime architecture

- One heavy search per tab, owned by a Web Worker. No `SharedArrayBuffer` or
  atomics, because GitHub Pages cannot set COOP/COEP headers — the engine is
  deliberately single-threaded.
- Chunks are fetched from same-origin static files and cached in IndexedDB
  (`chunkCache.ts`), keyed by the dataset id so a new dataset invalidates old
  data.
- WASM owns a per-chunk resident set; a window read only requires its owning
  chunks (`require_range`), while a full scan requires all chunks resident.
- Polling uses adaptive backoff (50 ms → 400 ms) rather than a fixed 100 ms,
  reducing CPU burn on long jobs without hurting short-search responsiveness.

## Measured work (capped test processes)

| Task | Time | Peak RSS |
| --- | --- | --- |
| Parity `exact` (18 queries) | 0.52 s | 66 MB |
| Parity `letters` | 0.26 s | 69 MB |
| Parity `dates` | 0.20 s | 63 MB |
| Parity `pattern` | 0.43 s | 65 MB |
| Parity `stats` | 0.06 s | 66 MB |
| Parity `windows` | 0.05 s | 61 MB |
| Parity full run (100 assertions) | ~1.5 s | ~67 MB |
| WASM smoke (12 checks) | <1 s | ~60 MB |
| 1B source SHA-256 validation | 1.02 s | 18 MB |
| 1B web-tree artifact validation | 1.35 s | 126 MB |

The 1B validator reads 1 MiB blocks and streams both per-chunk and whole-file
hashes; it never builds a 500 MB concatenation.

## Memory safety

A historical parity failure reached ~5 GB and was SIGKILLed by the kernel,
taking the parent process with it. The cause was a mismatch between the engine
cap (64) and the reference cap (200,000) combined with Node's structural diff
on assertion failure. The current script cannot reproduce it:

- one shared `PATTERN_MATCH_CAP = 64` for both sides;
- `isDeepStrictEqual` plus a bounded `brief()` formatter (a 200,000-element
  mismatch renders in 336 chars);
- a 250 ms RSS watchdog that aborts at 512 MB;
- `npm run test:parity` runs every phase under `systemd-run --user --scope`
  with `MemoryMax=1500M`, no swap.

## Dataset delivery costs

- 2M default: two ~489 kB packed chunks, 1 MB total — negligible.
- 1B: 100 chunks, 500,000,000 packed bytes (~478 MiB). A cold full search must
  download all of it once. Subsequent searches reuse the IndexedDB cache where
  the browser permits; Safari/iOS/private mode may evict it, so re-download is
  always supported.
- GitHub Pages artifact is ~1 GB recommended limit; the 478 MiB tree fits, but
  it is not committed to CI. Deployment is gated by
  `PI_ATLAS_PAGES_DEPLOY == 'true'`.

## Known limits

- No load/stress test of a 477 MiB cold transfer over a real Pages deployment;
  that requires the user to enable deployment and publish the 1B tree.
- No visual regression snapshots. E2E covers 28 viewport measurements and
  touch-target checks, which caught the Tailwind 3 → 4 migration cleanly.
- `framer-motion` was not replaced; its contribution is included in the
  framework chunk above.
