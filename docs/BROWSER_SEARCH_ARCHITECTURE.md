# Browser search architecture (Stages 4–7)

π Atlas now runs the **real** first 1,000,000,000 decimals of π entirely in the
browser. There is no backend, no running API server, no paid service and no
smaller "demo" dataset. This document is the map of how a click becomes a
result without a network service.

## 1. Invariants (do not regress)

1. **No mocks in production.** Every result comes from `pi-core` compiled to
   WASM over SHA-256-verified packed digits. The HTTP branch in `piApi.ts` is
   compiled out of production builds (`import.meta.env.MODE === "test"`) and
   exists only so the pre-existing integration tests can stub `fetch`.
2. **Never a smaller or approximate dataset.** `VITE_PI_DATASET_URL` selects a
   *dataset root*, not a fidelity level. The production root points at the
   full 1B set. The committed `public/data/pi-2m/` is the local-development
   default and is explicitly labelled in the UI.
3. **No leading `3`.** Positions are 1-based decimal positions *after* the
   point; the integer part is never in the packed dataset.
4. **Exact semantics.** Overlapping matches; chunk-boundary carry; `(10a+b)
   mod 26` letter encoding for both pair frames; `incomplete`/`truncated`/
   `capped` reported honestly; partial results never presented as complete.
5. **Server-shaped DTOs.** The UI was not rewritten. `dto.ts` emits byte-for-byte
   the same JSON shapes the Rust service emitted, including caps (200,000 exact
   and pattern; 10,000 per date format) and status strings
   `running | done | cancelled | failed | timeout`.

## 2. Layer diagram

```
React components / Zustand stores (unchanged)
        │  src/data/piApi.ts  — stable exported contract
        │
        ├─ MODE=test  → legacy HTTP client (fetch stubbed in tests)
        │
        └─ production → src/data/browser/localBackend.ts
                          │ job registry, result cache, manifest load
                          │ RPC over module Worker
                          ▼
                       src/data/browser/searchWorker.ts
                          │ owns PiEngine (WASM), ChunkLoader, cache
                          ▼
        ┌─────────────────┼──────────────────────┐
        │                 │                      │
  pi_wasm.js        chunkLoader.ts           chunkCache.ts
  (generated,       (HTTP GET, SHA-256,       (IndexedDB, best
   committed)        LRU, cancel)              effort)
        │                 │
        ▼                 ▼
  pi_wasm_bg.wasm    data/<set>/chunks/*.bin
  (Vite hashed)      (static Pages assets)
```

## 3. Boot sequence

1. `localBackend.init()` resolves the dataset root from
   `VITE_PI_DATASET_URL` (default `data/pi-2m/`) against `document.baseURI`,
   so GitHub Pages subpaths work.
2. Fetches `web-manifest.json` (camelCase, `pi-atlas-web-manifest-v1`) and
   `core-manifest.json` (Rust `pi-atlas-packed-v1`) in parallel.
3. `validateManifest()` checks version, format, datasetId, chunk count/offsets,
   byte math, SHA-256 shape and digit totals before anything is trusted.
4. Spawns `new Worker(new URL("./searchWorker.ts", import.meta.url), {type:"module"})`.
5. Worker calls `initWasm()` then `new PiEngine(coreManifestJson)`. No digits
   are resident. A `ready` message reports total digits and chunk count.

## 4. Chunk loading and integrity

- `ChunkLoader.loadChunk(i)` checks the in-memory LRU first, then deduplicates
  concurrent requests for the same chunk, then calls the injected fetcher.
- The fetcher in the Worker is `cachedFetcher(networkFetch, datasetId)`: it
  checks IndexedDB, then fetches `${baseUrl}${file}` with `cache:"force-cache"`,
  and writes verified bytes back to IndexedDB asynchronously.
- **Verification is always in `ChunkLoader`**, after the cache layer: byte
  length must equal `meta.bytes`, then Web Crypto SHA-256 must equal
  `meta.sha256`. Only verified bytes are cached or pushed into WASM.
- `PiEngine.set_chunk(i, bytes)` re-verifies both (defence in depth) before
  copying into the single owned `Dataset`.
- Downloads are abortable; `cancel(id)` aborts every in-flight chunk for that
  job, and cancellation is observed at chunk boundaries inside the scan.

## 5. Job model

`submit*` posts a job to the Worker and immediately returns either
`{cached:true, result}` or `{cached:false, jobId}`. Progress messages update
`job.progress` while running; `fetchJob`/`pollJob` read the snapshot exactly as
they did with the HTTP service.

- **One heavy search per tab.** Starting a new `exact`/`letters`/`dates`/
  `pattern`/`stats` job marks any previous one cancelled and the Worker adds
  its id to a cancellation set. Light `window`/`samples` reads run concurrently
  and never cancel a search.
- **Result cache keyed exactly like Rust**, e.g. `exact:<query>:<cap>`,
  `letters:<normalized>`, `dates:y:m:d`, `pattern:rows:cols:mode:cells:cols:cap`.
- `deleteJob` drops a finished job and its cached result.

## 6. DTO translation (`dto.ts`)

| WASM / core output | Server DTO | Notes |
| --- | --- | --- |
| `CoreExact` | `ExactResult` | adds `query`, `length`, `found`, `position_cap`, longest-prefix pair |
| `CoreLetters` | `LettersResult` | `normalizeWord` is the TS port of Rust `normalize_word`; `pair_values` = `(10a+b) mod 26` inputs |
| six `CoreExact` rows | `DatesResult` | dedup identical sequences, sort by found then first position |
| `CorePattern` | `PatternResult` | echoes request fields, adds `constrained_cells` |
| `CoreStats` (snake_case) | `DigitStats` (camelCase) | `total_digits → totalDigits`, `chi_square → chiSquare` |

`longest_existing_prefix` is computed only when `total === 0`, matching the
server, and is parsed defensively (`null` → `[0,0]`).

## 7. Storage tiers

| Tier | Scope | Failure mode |
| --- | --- | --- |
| WASM `Dataset` | current search | authoritative; freed on `drop_chunk`/`clear_chunks` |
| `ChunkLoader` LRU | Worker session, 32 chunks | eviction only |
| IndexedDB | cross-session, keyed by `datasetId` | best-effort; disabled by private mode/quota; never required for correctness |
| HTTP `cache:"force-cache"` | browser HTTP cache | best-effort |

`browserStorage.status()` and `.clear()` are exposed through `piApi.ts` for the
Settings screen. Changing `datasetId` invalidates every IndexedDB entry.

## 8. Files

- `src/data/piApi.ts` — unchanged public contract; test-only HTTP branch
- `src/data/browser/localBackend.ts` — job registry, RPC, manifests, DTO cache
- `src/data/browser/searchWorker.ts` — WASM + loader + progress + cancellation
- `src/data/browser/workerProtocol.ts` — typed messages
- `src/data/browser/dto.ts` — core → server DTO translation
- `src/data/browser/chunkLoader.ts`, `manifest.ts`, `sha256.ts` — Stage 2 core
- `src/data/browser/chunkCache.ts` — IndexedDB best-effort cache
- `src/generated/pi-wasm/` — committed generated bindings
- `service/crates/{core,wasm}` — source of truth for every algorithm
