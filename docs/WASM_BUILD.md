# WASM build (Stage 3 prototype)

How the real `pi-core` search algorithms are compiled to WebAssembly for a
backend-free, GitHub Pages-only browser app. **No algorithm is reimplemented** —
`pi-wasm` is a thin `wasm-bindgen` facade over the exact Rust code the HTTP
service uses, so Stage 5 parity testing compares identical implementations.

## 1. Toolchain (one-time)

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.127 --locked
```

| Component | Version | Why pinned |
| --- | --- | --- |
| Rust target | `wasm32-unknown-unknown` | Standard browser WASM target. |
| `wasm-bindgen` crate | `=0.2.127` (exact) | Must match the CLI exactly. |
| `wasm-bindgen-cli` | `0.2.127` | Version mismatch is a hard error at bindgen time. The crate is pinned with `=` so a Caret update cannot silently break the build. |

`wasm-pack` is **not** required; the build uses `cargo` + `wasm-bindgen` directly
so the steps are explicit and reproducible. GitHub Actions runners do not build
WASM in this stage — only `pi-server` is built natively in CI, and `pi-wasm`
adds no native build step.

## 2. Build

```bash
bash scripts/build_wasm.sh        # or: npm run build:wasm
```

The script:
1. `cargo build --release --target wasm32-unknown-unknown -p pi-wasm`
2. generates browser ES-module bindings with `wasm-bindgen --target web`
3. generates CommonJS bindings with `--target nodejs` for the smoke test
4. verifies the CLI version equals the pinned crate version

All outputs live under `service/target/` (already gitignored) and are **not**
committed:

```
service/target/wasm32-unknown-unknown/release/pi_wasm.wasm   # ~250 KB raw
service/target/wasm-pkg-web/                                 # browser: pi_wasm.js + pi_wasm_bg.wasm + .d.ts
service/target/wasm-pkg-node/                                # Node smoke test
```

The generated JS contains no `localhost`/dev-server references (verified), so
the only adaptation needed for Pages is serving the files same-origin. Stage 4
wires the browser bindings into the Pages build and replaces whole-dataset
residency with a chunked provider.

## 3. API surface (`PiEngine`)

Constructed from a `pi-atlas-packed-v1` **core** manifest JSON string and the
concatenated packed bytes. Manifest, every per-chunk SHA-256, the whole-file
SHA-256 and the leading digits are all verified before the engine is usable; a
corruption throws. All methods delegate to `pi-core` unchanged.

| Method | Delegates to | Result |
| --- | --- | --- |
| `search_exact(query, cap)` | `exact::search_exact` | JSON `ExactResult` (`total`, capped `positions`, `truncated`, `incomplete`) |
| `find_first(query)` | `exact::find_first` | 1-based position or `0` (bigint) |
| `longest_existing_prefix(query)` | `exact::longest_existing_prefix` | JSON tuple or `null` |
| `search_letters(word, cap)` | `letters::search_letters` | JSON `LetterResult` (both pair frames, `(10a+b) mod 26`) |
| `search_pattern(specJson, cols, cap)` | `pattern::search_pattern` | JSON `PatternResult` (colour/shape grids) |
| `search_dates(y, m, d)` | `exact::search_exact` × 6 | JSON array of all six date encodings |
| `compute_stats()` | `stats::compute_stats` | JSON `DigitStats` (counts + chi-square) |
| `get_window(start, end)` | `window::window_1based` | ASCII digits for 1-based inclusive range |

Positions are 1-based decimal positions after the point; the leading `3` is
never part of the dataset. `u64` values cross the boundary as `bigint`.

## 4. Smoke test

```bash
bash scripts/build_wasm.sh && npm run test:wasm
# equivalent: node scripts/wasm_smoke.cjs
# optional:   PI_WASM_DATA_DIR=/path/to/packed-dataset node scripts/wasm_smoke.cjs
```

The smoke test instantiates the generated WASM in Node and drives **every**
method against the real committed 2M-digit π fixture
(`/home/megalith/pi-atlas-build/data-2m`, overridable via `PI_WASM_DATA_DIR`).
It asserts:

- geometry (2,000,000 digits, 2 chunks) and exact leading digits (`1415926535`);
- the known `12` → position `148` checkpoint via `find_first` and `search_exact`
  (1-based, overlapping, uncapped `total`, `truncated`/`incomplete` flags);
- absent-query behaviour (`find_first` → 0, prefix → null/valid tuple);
- both letter frames, colour-grid pattern at the known first cell, all six date
  encodings for 2024-01-15, and full count/chi-square stats;
- the constructor rejects checksum-corrupted packed bytes.

Result: **10/10 checks pass**. This is an opt-in test because it requires the
Rust WASM toolchain; it is intentionally not part of `npm test`, which CI runs
without Rust-WASM installed.

## 5. Known limitations (deferred, not defects)

- **Whole-dataset residency**: the prototype passes all packed bytes into
  WASM (`packed.to_vec()`, ~1 MB for 2M digits, ~477 MB for the full 1B set).
  Stage 4 replaces this with on-demand chunk loading; it is never acceptable to
  hand the browser 477 MB at once in the final app.
- **Manifest dialect**: the facade consumes the Rust core manifest
  (snake_case) from the packed dataset, not the Stage 2 camelCase web manifest.
  Stage 4 adds the adapter. This is a prototype seam, not a correctness issue.
- **Single-threaded**: no `SharedArrayBuffer`/atomics, because GitHub Pages
  cannot set COOP/COEP headers. Workers + one heavy search per tab is the plan.
- **`normalize_word` / `base` warnings**: harmless dead-code/unused-assignment
  warnings in `pi-core`, left untouched to preserve reference semantics.
