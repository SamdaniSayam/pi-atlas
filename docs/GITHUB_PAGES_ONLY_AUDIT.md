# GitHub Pages-Only Architecture — Stage 1 Audit & Feasibility Report

**Date:** 2026-11-17
**Stage:** 1 of 11 (Audit & feasibility) — **no migration code has been written**
**Scope:** Can π Atlas search the **actual first 1,000,000,000 decimals of π** entirely in the browser, deployed only through GitHub Pages, with no backend / paid service / credit card?
**Method:** Static audit of the full frontend and Rust service, on-disk verification of the packed datasets, live HTTP tests against the deployed Pages site, and current (2026) GitHub/browser platform-limit research.

---

## Executive verdict — CONDITIONAL GO (viable, but narrow and costly)

The architecture is **technically possible**, but only through one specific delivery path, and it carries two hard, honest costs that the acceptance criteria should acknowledge up front:

1. **The dataset can be served from GitHub Pages.** The 477 MiB packed dataset fits under the 1 GB published-site limit, and 5 MB chunk files are small enough to serve individually. Range requests are supported and cache headers are present (verified live — §10). **However**, the free-tier GitHub Actions artifact quota (500 MB shared with Packages) makes the "upload a 477 MB Pages artifact from CI" route **exceed the free quota** once the frontend and tar overhead are added. The only reliable free route is to **commit the chunk files to a branch that Pages serves directly** (so no large artifact is uploaded). Details in §12.
2. **A full search must read the whole dataset.** Occurrence counting, statistics, and unmatched patterns require scanning all 1,000,000,000 digits → **the first real search downloads all ~477 MiB**. On-demand chunk loading (§6) helps early-exit queries and digit windows, but cannot avoid a full transfer for full-data searches. At the 100 GB/month soft Pages bandwidth cap, that is roughly **210 full searches per month**. On mobile or slow links the first search is measured in minutes.

**WASM compilation of the reference algorithms is feasible** (§7): the search core is pure Rust over a packed byte slice, already written as a chunk-by-chunk streaming loop. The blockers are mechanical (`std::fs` loading, full-dataset `Vec<u8>` residency, non-portable `Instant`/closure control hooks), not algorithmic.

**Recommendation:** proceed to Stage 2 only if the following are accepted as design constraints rather than surprises:
- dataset delivered as static same-origin chunks from a Pages-served branch (not Release assets, not LFS);
- first full search ≈ 477 MiB transfer;
- IndexedDB caching is best-effort (Safari/mobile eviction is real — §9);
- one heavy search per tab, single-threaded WASM.

If the product requires an instant first search, offline-on-first-visit, or reliable 477 MB caching on iOS Safari, this architecture **cannot** meet that and a backend remains necessary. See "Blockers" at the end.

---

## 1. Current architecture

```
Browser (GitHub Pages static bundle)
   │  fetch /api/v1/*   (same-origin in dev; VITE_PI_ATLAS_API in prod)
   ▼
Rust pi-server (axum/tokio)  ──owns──▶  packed 1B dataset on disk (477 MiB)
   │  async jobs (submit → poll → cancel), result cache
   ▼
pi-core (pure Rust): exact / pattern / letters / dates / stats / window
```

- Frontend: Vite + React 18.3 + TS strict, HashRouter, Zustand, TanStack Virtual, Framer Motion, Lucide, Canvas, Vitest + RTL, Playwright, axe-core. Deploys to `https://samdanisayam.github.io/pi-atlas/`.
- There are **no Web Worker files and no WASM** in `src/` today (verified: `find src -iname '*worker*'` → empty). All heavy compute is server-side.
- The browser holds **no dataset** — only small digit windows via `GET /window`, cached in a 2 KB-bucket LRU (`src/data/digitWindow.ts`).

Exact sources: `src/App.tsx` (manifest load after first paint), `src/data/piApi.ts`, `src/data/piStore.ts`, `src/data/digitWindow.ts`, `src/state/useSearch.ts`, `service/crates/server/src/*`, `service/crates/core/src/*`.

---

## 2. Every backend-dependent feature

All backend I/O funnels through `src/data/piApi.ts` (343 lines). Endpoints and their consumers:

| Endpoint (piApi.ts) | Used by | Feature |
| --- | --- | --- |
| `GET /manifest` (`fetchManifest`, L96) | `App.tsx`, `piStore.ts`, Home, About | dataset size/chunk count/checkpoints/first digits |
| `GET /window?start&end` (`fetchWindowDigits`, L118) | `digitWindow.ts`, DigitViewer, PixelField, Colour/Shape explorers | digit windows for visualization |
| `GET /samples?count` (`fetchSamples`, L131) | Home / minimap | evenly spread digit samples |
| `GET /stats` (`fetchStats`, L148) | Statistics / "Big Question" panel | digit counts + chi-square over all 1B |
| `POST /jobs/exact` (`submitExact`, L251) | Digit explorer, Home quick search, Tour | exact numeric search |
| `POST /jobs/letters` (`submitLetters`, L255) | Letter explorer | word search (both pair frames) |
| `POST /jobs/dates` (`submitDates`, L259) | Date explorer | six date encodings |
| `POST /jobs/pattern` (`submitPattern`, L272) | Colour + Shape explorers | 2-D colour/shape patterns |
| `GET /jobs/{id}` (`fetchJob`/`pollJob`, L277/325) | `useSearch.ts` | progress + result |
| `POST /jobs/{id}/cancel` (`cancelJob`, L302) | `useSearch.ts`, UI cancel buttons | cancellation |
| `DELETE /jobs/{id}` (`deleteJob`, L307) | History panel | cleanup |

Result DTOs (`ExactResult`, `LettersResult`, `DatesResult`, `PatternResult`) carry `incomplete` / `truncated` / `capped` flags — the existing "partial search" honesty contract that the browser engine must preserve.

**Every one of these 11 endpoint families must be replaced by a local `SearchService` interface** (§12). The 14 explorers/features listed in the task (Home, Digits, Number-pattern, Date, Letter, Colour, Shape, Probability Lab, Statistics, History, Tour, sharing/export, Settings, mobile nav) otherwise depend only on client code and can be kept intact.

---

## 3. Existing Rust search algorithms

All in `service/crates/core/src/` (pure Rust; `pi-core` has **no** tokio/axum/threads):

| File | Function | Semantics that must be preserved |
| --- | --- | --- |
| `exact.rs` | `search_exact` (L141) | Overlapping matches via `memchr` seed + early verify; **chunk-boundary carry** of `L-1` digits; 1-based positions; uncapped `total`, capped `positions`, `truncated`/`incomplete` flags; cancellation, deadline, progress. |
| `exact.rs` | `longest_existing_prefix` (L82) | KMP pass; longest proper prefix that occurs, with first 1-based position; omitted on deadline. |
| `exact.rs` | `find_first` (L214) | Early-exit first occurrence, same carry logic. |
| `letters.rs` | `search_letters` (L101) | `(10*a+b) mod 26`; **Frame A** pairs (0,1),(2,3)… → pos `2g+1`; **Frame B** pairs (1,2),(3,4)… → pos `2g+2`, with a one-digit cross-chunk carry; KMP with overlapping continuation; `MATCH_CAP = 200_000`; NFD uppercase A–Z normalization, 12-letter cap (server `normalize.rs`). Bias A–V (4 pair values) vs W–Z (3) is intentional. |
| `pattern.rs` | `search_pattern_direct` (L111) | 2-D fold into `field_cols` rows; colour mode digit 0–9, shape mode 0–4→0 / 5–9→1, `-1` wildcard; **never spans a row boundary**; reports top-left 1-based position; `anchors`, `matched`, `capped`. `search_pattern_optimized` (bit-parallel Shift-And, L177) is parity-tested against direct (L437). |
| `stats.rs` | `compute_stats` (L12) | 10 digit counts + chi-square (df=9) over all digits. |
| `window.rs` | window read | 1-based inclusive digit window from packed chunks. |
| `manifest.rs` | `Manifest::validate` / `verify_packed` (L63/97) | Per-chunk + whole-file SHA-256, chunk-count/digit-sum checks, leading-digit check. |
| `pack.rs` | pack/unpack | 2 digits/byte, big nibble = even 0-based index. |
| server `jobs.rs` / `jobs_create.rs` | job registry | In-memory `HashMap<u64, Arc<JobState>>`; submit→poll→cancel; deadline; bounded concurrency; TTL. |

The core already contains **parity tests** against TypeScript-engine references (`exact.rs` L283/L347, `letters.rs` L208, `pattern.rs` L437) — these are the seed for Rust-vs-WASM correctness tests (Stage 5).

---

## 4. Dataset file sizes and formats

Verified on disk:

| Dataset | Digits | Chunk digits | Chunks | Packed bytes | On disk | SHA-256 (concatenated packed) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `data-1b` | 1,000,000,000 | 10,000,000 | 100 | 500,000,000 | 477 MiB | `054944fdbab4a1d839b0afa808955c126c0ee35b794d4181b027b973f7610911` |
| `data-2m` | 2,000,000 | 1,000,000 | 2 | 1,000,000 | ~1 MB | `d6172c277dff1dcf66168a8017fe74280021ca58ca4febf3a916c4b0a5ce67d8` |
| `public/pi-2m.txt` | 2,000,000 (ASCII) | — | — | 2,000,000 | 2 MB | `efcbafbaf15047f32f70d8b1b008bac527e9f76d4d4b995d7f36dfd6dd8dc7ed` |

Format `pi-atlas-packed-v1`: `manifest.json` (format, total/chunk digits, first 64 digits, checkpoints, whole-file sha256, per-chunk `{digits, bytes, sha256}`) + `chunks/chunk_NNNNN.bin`, each 5,000,000 bytes at 1B. Each chunk has its own SHA-256; the concatenation has the whole-file SHA-256. Digit positions are **after the decimal point** — the leading `3` is excluded (core `lib.rs` L9–11).

---

## 5. Search index sizes

**There is no persistent search index.** `chunk_digit_starts` is a small in-memory lookup table (100 `u64`s). `manifest.checkpoints` is a handful of known-answer pairs (e.g. `{"query":"12","first_position":148}`). The FM-index exists **only in `crates/bench/src/main.rs`** (L17, L207) as a benchmark experiment; prior extrapolations put a 1B FM-index at ~29 GB — far beyond browser feasibility and not used by production search. **No index needs to be shipped to the browser**; the packed digit chunks are the whole data set. This is favorable for the migration (no index-format work), but it is also why a full search must stream every chunk.

---

## 6. Dataset chunking possibilities

- The existing 100 × 5 MB chunks already sit in the task's suggested 4–16 MB range. They are **independently downloadable files**, so no reliance on Range requests (§10).
- The algorithms are naturally chunk-streaming: `exact.rs` L161, `letters.rs` L121, `stats.rs` L16 all loop `for c in 0..chunk_count()` with a small carry. This maps cleanly to "load chunk c → process → release."
- Boundary correctness is already solved in Rust (carry logic) with parity tests over many chunk sizes (2, 4, 10, 50, 100, 200, 2000…). Re-chunking to smaller files would require regenerating chunks + checksums (`scripts/pack_dataset.py --chunk-digits`) but **must keep whole-dataset checksum identity** or the manifest must be regenerated and re-verified.
- Recommended chunk delivery: publish the existing 5 MB chunk files verbatim as static assets under `/pi-atlas/chunks/`, with a browser manifest pointing at them. On-demand logic downloads a chunk only when a scan reaches it, verifies its SHA-256 (WebCrypto `SHA-256`), then caches it.

---

## 7. WASM compilation feasibility

Target `wasm32-unknown-unknown` + `wasm-bindgen`.

**Portable as-is:** `pi-core`'s `pack.rs`, `pattern.rs`, `letters.rs`, `stats.rs`, `window.rs`, `manifest.rs`, and most of `exact.rs`. Dependencies `memchr` (SIMD-free on WASM), `sha2` (pure Rust), `serde`/`serde_json`, `thiserror` all compile to WASM. The algorithms are pure functions over `&Dataset`/`&[u8]`.

**Blockers (all mechanical, none algorithmic):**
1. `dataset.rs` uses `std::fs::read` (L18, L37) — replace with an in-memory chunk provider that receives bytes fetched by JS.
2. `Dataset.packed: Vec<u8>` (lib.rs L29) holds all 500 MB. For chunk-streaming, refactor to a chunk-provider abstraction so only the current ~5 MB chunk is resident (a 500 MB WASM linear-memory allocation is technically addressable under wasm32's 4 GB limit but is exactly what "don't download everything" forbids).
3. `ScanControl` uses `std::time::Instant` and `&dyn Fn` closures (exact.rs L26–30) — `Instant::now()` works under wasm32-unknown-unknown via the wasm-bindgen JS shim, but the cancellation/deadline callbacks should be reworked into integer counters / explicit JS callbacks for a clean ABI.
4. **`pi-server` and `crates/bench` do NOT compile to WASM** (axum, tokio, threads, `/proc`, `fm-index`, `std::fs`). Only `pi-core` should be wrapped in a thin `wasm-bindgen` crate.

**Conclusion:** wrap `pi-core`, not the server. No algorithm rewrite is required to start; a thin `#[wasm_bindgen]` facade exposes `initialize`, `set_chunk(index, bytes)`, `search_exact`, `search_letters`, `search_dates`, `search_pattern`, `compute_stats`, `get_window`, `cancel`. TypeScript equivalents should only be written if a function cannot be wrapped, and then only after exact parity tests — matching the task's rule.

---

## 8. Browser memory requirements

| Item | Size | Notes |
| --- | --- | --- |
| Packed dataset (if fully resident) | 500 MB | Avoid — violates on-demand requirement; risky on mobile WASM heap. |
| One chunk packed | 5 MB | Recommended resident unit. |
| One chunk unpacked to ASCII scratch | 10 MB | `unpack_into` into `Vec<u8>`; freed per chunk. |
| Pattern row buffers | ≤ `rows × field_cols` bytes | Small for typical fields. |
| Result position vectors | up to `position_cap` (e.g. 4096) or `MATCH_CAP` 200k for letters | ~1.6 MB worst case per letters frame. |

With chunk streaming the steady-state WASM working set is **tens of MB**, not 500 MB — comfortable on a modest device. The UI must never unpack all 1B digits at once (would be ~1 GB ASCII).

---

## 9. Browser storage requirements

- **IndexedDB** is the right place for verified chunks; Cache API for the manifest/WASM/static assets; in-memory Map for the active search and to dedupe in-flight downloads.
- **Quotas are not universal** (verified 2026): Chrome allows up to ~60% of free disk; Firefox ~20%; Safari/iOS ~1 GB nominal with **7-day eviction of script-writable storage** unless the app is installed as a PWA; private/incognito mode gives a small, ephemeral IDB store. **Do not assume 477 MB is cacheable.**
- Required behaviors: detect `navigator.storage.estimate()` / `persist()`, handle quota errors by falling back to in-memory re-fetch, validate cached chunks by SHA-256 before reuse, invalidate on manifest/dataset version change, expose a storage-status indicator and a "clear cached dataset" action.
- Practical expectation: desktop Chrome/Firefox can cache the whole dataset; Safari/mobile may only cache partially or evict after 7 days — searches still work by re-downloading.

---

## 10. GitHub Pages deployment limitations (with live evidence)

| Constraint | Value | Source / evidence | Impact |
| --- | --- | --- | --- |
| Published site size | **1 GB hard** | GitHub Pages docs / research | 477 MiB fits, with room for frontend. |
| Source repo size | **1 GB recommended** (soft) | GitHub docs | Committing 477 MiB of chunks is under but heavy; clone/fetch cost. |
| Per-file size | No Pages-specific limit; Git warns >50 MB, blocks >100 MB commits | GitHub docs | Our 5 MB chunks are safe. |
| Actions artifact storage | **500 MB shared with Packages**, 90-day expiry | GitHub community/docs | A 477 MiB dataset + frontend + tar overhead **exceeds** the free artifact quota → the CI-artifact delivery route is not viable on free tier. |
| Max Pages artifact | recommend <1 GB, absolute 10 GB, 10-min deploy timeout | `upload-pages-artifact` docs | 477 MiB would be slow and fragile even if quota allowed. |
| Bandwidth | **100 GB/month soft** | GitHub docs | ≈210 full-dataset searches/month; soft, may throttle. |
| Range requests | **Works** | Live test: `Range: bytes=100-199` on `/pi-atlas/pi-2m.txt` → `HTTP 206`, `content-range: bytes 100-199/2000000`, exactly 100 bytes | Useful but not required (separate chunks are simpler). |
| Cache headers | `cache-control: max-age=600`, `etag`, `last-modified`, `accept-ranges: bytes` | Live `curl -I` on the deployed file | Browser/CDN cache for 10 min; IndexedDB handles long-term reuse. |
| Static binary files | Served with correct `Content-Type` | Live test: 200 + `text/plain` on 2 MB fixture | 5 MB `.bin` chunks will serve fine. |
| Cross-origin isolation (for WASM threads) | Pages does **not** set `COOP`/`COEP` | Pages header behavior | `SharedArrayBuffer` / multi-threaded WASM unavailable → use single-threaded WASM + Workers (as planned). |

**Release assets (Option B) are NOT viable for browser delivery** (research verified): the GitHub download URL is a 302 redirect to S3, preflight `OPTIONS` does not follow redirects, and the final asset lacks `Access-Control-Allow-Origin` → browser `fetch` of a chunk fails. **Git LFS (Option C) is NOT viable**: Pages serves LFS *pointer files* unless objects are materialized, and free LFS is 1 GB storage / 1 GB-month bandwidth.

**Only Option A — chunks as static files in the Pages deployment — is viable.** The one workable free mechanism is to keep the 5 MB chunk files in a Pages-served branch/repo tree and point Pages at it, so the data is never uploaded as a large Actions artifact.

---

## 11. Expected performance limitations

- **First search:** ~477 MiB download. At 10 Mbps ≈ 6–7 min; at 50 Mbps ≈ 80 s; plus SHA-256 verification of 500 MB (~1–3 s in WebCrypto). Subsequent searches from a warm IndexedDB cache are fast; after eviction, repeat the transfer.
- **Compute:** native 1B scans are seconds (prior service measurements); single-threaded WASM is typically 2–5× slower → tens of seconds for a full unmatched scan. Acceptable, but must run in a Worker with progress.
- **Early-exit queries** (e.g. "first occurrence of 12" at position 148) only need the first few chunks → fast even cold. **Full-count/statistics/date/pattern** searches need all 100 chunks → full transfer.
- **Pages bandwidth** is the scaling ceiling, not compute (§10).
- **Mobile:** memory is OK with chunk streaming (§8), but storage eviction (§9), download time, and battery are the real constraints. Must degrade to "download required" messaging, not fail.

---

## 12. Recommended migration strategy

### Dataset hosting decision
- **Option A (static files in Pages deployment): CHOSEN.** Publish `manifest.json` + the 100 × 5 MB chunk files as same-origin static assets under `/pi-atlas/`. Keep them in a Pages-served branch/tree to avoid the 500 MB Actions artifact quota. Browser fetches chunks on demand, verifies SHA-256, caches in IndexedDB.
- **Option B (Release assets): REJECTED** — browser CORS failure (§10). (Release assets remain useful as a *CI source* to assemble the Pages tree, since `gh release download` has no CORS restriction server-side — but the shipped chunks must be static Pages files.)
- **Option C (Git LFS): REJECTED** — pointer files + 1 GB-month bandwidth (§10).

### Engine
Wrap `pi-core` in a `wasm-bindgen` crate (`pi-wasm`), refactor `Dataset` to a chunk provider, single-threaded, in a dedicated Web Worker. Expose a stable `SearchService` interface to the UI (e.g. `initializeEngine`, `loadDatasetChunk`, `searchPattern`, `searchDate`, `searchLetters`, `searchColour`, `getOccurrences`, `cancelSearch`, `getSearchProgress`) so the UI never imports WASM directly. TypeScript fallbacks only after parity tests.

### Delivery / build
Update the workflow to build WASM (`wasm32-unknown-unknown` + `wasm-bindgen-cli`), generate/validate the manifest + per-chunk checksums, build the frontend, run browser tests, validate the artifact (no localhost, correct base path, resolvable chunk/WASM/worker URLs), deploy to Pages. Keep the existing `28b2479`-line baseline recoverable; do **not** deploy an unverified migration over the live site.

### Ordered stages (as specified)
2 dataset chunking prototype → 3 WASM compile prototype → 4 browser engine prototype → 5 Rust-vs-browser correctness (2M then 1B) → 6 worker+storage → 7 frontend integration → 8 Pages packaging/deploy → 9 full 1B validation → 10 mobile/perf → 11 production release. Keep Rust service as reference through Stage 12/14.

### Stage-2 safety
**Safe to begin** the chunking/manifest prototype on the 2M fixture: it is read-only with respect to production, uses the existing pack script and checksums, and needs no deployment changes. Stop conditions before proceeding further: (a) WASM module cannot be built from `pi-core` without reimplementing algorithms; (b) browser SHA-256 verification of a 5 MB chunk is not feasible; (c) 2M Rust-vs-WASM parity fails on boundary-spanning patterns.

---

## Blockers / exact limiting components

Nothing makes the architecture *impossible*, but three constraints bound it and must be accepted or they stop the project:
1. **Dataset delivery mechanism** — free Actions artifacts cannot hold a 477 MB dataset; the data must live in the Pages-served repo/branch as static chunks (repo grows by ~477 MiB). If committing ~477 MiB of binary to the repository is disallowed by policy, **no free GitHub-hosted delivery path exists** (Release assets fail CORS; LFS fails pointer/bandwidth) → the architecture is blocked.
2. **First-search transfer cost** — a complete 1B search necessarily downloads ~477 MiB on a cold cache. If "no large download before a full result" is a hard requirement, it is incompatible with a backend-free full-1B search.
3. **Cache durability** — 477 MB cannot be assumed to persist in Safari/iOS/private mode; the app must work by re-downloading. If offline/permanent caching is required, this architecture cannot guarantee it.

---

## Evidence appendix

- Live Pages test (`curl -I` / `Range` on `https://samdanisayam.github.io/pi-atlas/pi-2m.txt`): HTTP 200, `accept-ranges: bytes`, `cache-control: max-age=600`, ETag; Range → 206, correct `content-range`, 100 bytes returned.
- On-disk dataset verification: `du -sh`, manifest field dump (1B: 1e9 digits / 100 chunks / 5e6 bytes each / sha `0549…0911`; 2M: sha `d617…67d8`).
- Source audit: `find`/`grep` over `src/` (no worker/WASM files; 11 backend endpoint families in `piApi.ts`) and `service/crates/{core,server,bench}/src/*.rs`.
- Platform limits: GitHub Pages docs, `upload-pages-artifact` docs, GitHub community artifact-quota discussion, Release-asset CORS report, IndexedDB quota/eviction research (all 2026 sources).
