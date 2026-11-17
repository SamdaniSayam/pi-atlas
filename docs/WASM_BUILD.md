# WASM build (Stages 3–4)

How the real `pi-core` search algorithms are compiled to WebAssembly for a
backend-free, GitHub Pages-only browser app. **No algorithm is reimplemented** —
`pi-wasm` is a thin `wasm-bindgen` facade over the exact Rust code the HTTP
service uses, so Stage 5 parity testing compares identical implementations.

## 1. Toolchain (one-time, local only)

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.127 --locked
```

| Component | Version | Why pinned |
| --- | --- | --- |
| Rust target | `wasm32-unknown-unknown` | Standard browser WASM target. |
| `wasm-bindgen` crate | `=0.2.127` (exact) | Must match the CLI exactly. |
| `wasm-bindgen-cli` | `0.2.127` | Version mismatch is a hard error at bindgen time. The crate is pinned with `=` so a caret update cannot silently break the build. |

`wasm-pack` is **not** required; the build uses `cargo` + `wasm-bindgen` directly.
**GitHub Pages / CI never compiles Rust**: the generated browser bindings are
committed under `src/generated/pi-wasm/` and Vite bundles them as a normal static
asset. Only a developer changing `pi-core` or `pi-wasm` needs this toolchain.

## 2. Build

```bash
bash scripts/build_wasm.sh        # or: npm run build:wasm
```

The script:
1. `cargo build --release --target wasm32-unknown-unknown -p pi-wasm`
2. generates browser ES-module bindings with `wasm-bindgen --target web`
3. copies them into `src/generated/pi-wasm/` (committed, so Pages needs no Rust)
4. generates CommonJS bindings with `--target nodejs` for the smoke test
5. verifies the CLI version equals the pinned crate version

Outputs:

```
service/target/wasm32-unknown-unknown/release/pi_wasm.wasm   # intermediate (gitignored)
service/target/wasm-pkg-web/                                 # regenerated (gitignored)
service/target/wasm-pkg-node/                                # Node smoke test (gitignored)
src/generated/pi-wasm/pi_wasm.js                             # COMMITTED browser glue
src/generated/pi-wasm/pi_wasm.d.ts                           # COMMITTED types
src/generated/pi-wasm/pi_wasm_bg.wasm                        # COMMITTED ~232 KB binary
```

Vite rewrites `new URL('pi_wasm_bg.wasm', import.meta.url)` in the glue into a
hashed asset URL, so the binary ships as `dist/assets/pi_wasm_bg-<hash>.wasm`.
The generated JS contains no `localhost`/dev-server references (verified in CI).

## 3. API surface (`PiEngine`)

Constructed from a `pi-atlas-packed-v1` **core** manifest JSON string. **No
digit bytes are resident at construction.** JS then calls `set_chunk(i, bytes)`
for each chunk it has downloaded and SHA-256 verified. Each `set_chunk`
re-verifies length and per-chunk SHA-256 inside WASM (defence in depth); a
corruption throws and is never stored. Full scans require every chunk resident;
window and single-digit reads require only the owning chunks.

| Method | Delegates to | Result |
| --- | --- | --- |
| `set_chunk(i, bytes)` | `pi_core::manifest::sha256_hex` | stores one verified packed chunk (5 MB for 1B) |
| `drop_chunk(i)` / `clear_chunks()` | — | release resident bytes under memory pressure |
| `has_chunk(i)` / `loaded_chunks()` | — | residency introspection |
| `search_exact(query, cap)` | `exact::search_exact` | JSON `ExactResult` (`total`, capped `positions`, `truncated`, `incomplete`) |
| `find_first(query)` | `exact::find_first` | 1-based position or `0` (bigint) |
| `longest_existing_prefix(query)` | `exact::longest_existing_prefix` | JSON tuple or `null` |
| `search_letters(word, cap)` | `letters::search_letters` | JSON `LetterResult` (both pair frames, `(10a+b) mod 26`) |
| `search_pattern(specJson, cols, cap)` | `pattern::search_pattern` | JSON `PatternResult` (colour/shape grids) |
| `search_dates(y, m, d)` | `exact::search_exact` × 6 | JSON array of all six date encodings |
| `compute_stats()` | `stats::compute_stats` | JSON `DigitStats` (counts + chi-square) |
| `get_window(start, end)` | `window::window_1based` | ASCII digits for 1-based inclusive range |
| `get_digit(position)` | direct packed-byte read | one digit by 1-based position |

Positions are 1-based decimal positions after the point; the leading `3` is
never part of the dataset. `u64` values cross the boundary as `bigint`.

### Memory invariant

`PiEngine` owns exactly **one** `Dataset` whose `chunks: Vec<Vec<u8>>` buffers
are filled in place. Searches borrow `&self.dataset`; **nothing is cloned per
call**. A full 1B search holds ~500 MB packed (not ~1 GB), and the Worker's own
verified-array copies add a bounded LRU (~32 chunks ≈ 160 MB) unless those
buffers are released after `set_chunk`. This was the key Stage 4 fix over the
whole-dataset prototype.

## 4. Smoke test

```bash
bash scripts/build_wasm.sh && node scripts/wasm_smoke.cjs
# optional: PI_WASM_DATA_DIR=/path/to/packed-dataset node scripts/wasm_smoke.cjs
```

The smoke test instantiates the generated WASM in Node and drives **every**
method against the real committed 2M-digit π fixture
(`public/pi-2m.txt`, packed locally via `scripts/pack_dataset.py`). It asserts:

- geometry (2,000,000 digits, 2 chunks) and exact leading digits (`1415926535`);
- the known `12` → position `148` checkpoint via `find_first` and `search_exact`
  (1-based, overlapping, uncapped `total`, `truncated`/`incomplete` flags);
- absent-query behaviour (`find_first` → 0, prefix → null/valid tuple);
- both letter frames, colour-grid pattern at the known first cell, all six date
  encodings for 2024-01-15, and full count/chi-square stats;
- chunk residency gating (window works with only owning chunks resident);
- `set_chunk` rejects checksum-corrupted bytes.

Result: **12/12 checks pass**. This is opt-in because it requires the Rust WASM
toolchain; it is intentionally not part of `npm test`, which CI runs without
Rust installed. Stage 5 adds the independent `scripts/parity_wasm.cjs` reference
comparison over the same 2M fixture.

### Parity memory safety (do not bypass)

Run parity via `npm run test:parity` (or `bash scripts/parity_safe.sh`). It runs
each phase in a short-lived process under `systemd-run --user --scope` with
`MemoryMax=1500M` and no swap, then the full script. All phases peak near 67 MB.

The script also defends itself in code, so an uncapped invocation cannot repeat
the historical 5 GB OOM:
- a single `PATTERN_MATCH_CAP = 64` is shared by the engine and the reference;
- `eq()` uses `isDeepStrictEqual` (boolean, no diff) and a `brief()` formatter
  that truncates arrays/objects regardless of size (200,000 elements → 336 chars);
- a 250 ms RSS watchdog aborts at 512 MB before the kernel OOM killer can
  SIGKILL the process and take a parent agent app down with it.

`PI_PARITY_SELFTEST=1 node scripts/parity_wasm.cjs` proves the bounded formatter.
If adding a new comparison phase, reuse `eq()` and the shared cap — never
`assert.deepEqual` on large arrays.

## 5. Known limitations (accepted, not defects)

- **Single-threaded**: no `SharedArrayBuffer`/atomics, because GitHub Pages
  cannot set COOP/COEP headers. One heavy search per tab in a Worker is the plan.
- **Manifest dialects**: the facade consumes the Rust core manifest (snake_case)
  while the browser loader consumes the Stage 2 camelCase web manifest. Both are
  emitted by `scripts/make_web_dataset.py`; `localBackend.ts` passes each to the
  right layer. This is a deliberate seam, not a correctness issue.
- **Cold download**: a full 1B search must download ~477 MiB once. See
  `docs/BROWSER_SEARCH_ARCHITECTURE.md`.
- **`normalize_word` / `base` warnings**: harmless dead-code/unused-assignment
  warnings in `pi-core`, left untouched to preserve reference semantics.
