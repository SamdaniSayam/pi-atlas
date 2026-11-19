# π Atlas — Final Implementation Report

**Date:** 2026-11-20 · **Status:** complete · **All quality gates green.**

This report supersedes the earlier 2M-era status notes. The production build is
configured to scan **1,000,000,000 decimal digits of π** by setting
`VITE_PI_DATASET_URL=data/pi-1b/`; local development and CI default to the
committed `data/pi-2m/` set. The 2M fixture remains in the repo as a parity
reference and as the dataset used by local tests. A full product and technical
specification is in [PRD.pdf](PRD.pdf).

## Executive summary

π Atlas is a fully static, zero-backend web app that lets people search for
numbers, dates, words, colours and shapes in π, understand the probability of
what they found, and export a collectible, rarity-tiered Wish Card PNG. Every
count on screen comes from a real scan of a verified local dataset. All
computation — including search, odds, QR generation and PNG rendering — runs on
the user's device.

## Scope delivered

- **Five explorers** — Digits, Dates, Letters, Colours, Shapes — with live
  progress, cancellation, virtualised results and honest model estimates.
- **Probability Laboratory** — the cliff between "everywhere" and
  "practically impossible", computed client-side.
- **Four-act guided tour** — each act runs a real search.
- **Wish Cards** — four rarity tiers (Legendary / Rare / Lucky / Twilight),
  calm deterministic copy on a flat Royal Observatory Plate, two styles
  (collectible, clean), three PNG formats, scannable QR with `src=card`, privacy
  mode, dedications, captions and a dev gallery with local verification.
- **Sharing and state** — hash deep links, Copy link, shared-result banner,
  search history, theme settings and `w`/`Esc` shortcuts.
- **Accessibility and mobile-first design** — keyboard painting, focus traps,
  ARIA live regions, skip link, reduced motion, 4.5:1 contrast, bottom sheets
  and navigation, no horizontal overflow from 280px to 1920px.
- **Pre-deploy smoke test** — read-only sequential Playwright walk with a
  Markdown/JSON report and strict pass/fail semantics.

## Architecture at a glance

| Layer | Implementation |
| --- | --- |
| Dataset | Decimal digits packed 4 bits per digit into same-origin chunks under `public/data/pi-2m/` (local/CI default) or `public/data/pi-1b/` (production); a build-time variable selects the root and `web-manifest.json` / `core-manifest.json` carry per-chunk and whole-file SHA-256 checksums. |
| Engine | Committed WASM bindings (`src/generated/pi-wasm/`) plus pure TypeScript parity engines in `src/engine/`; scan runs in a Web Worker with progress and cancel. |
| Data client | `src/data/` verifies the manifest, fetches/caches chunks and builds digit windows and context strips. |
| UI | React 18 + TypeScript + Vite 6, Tailwind 4 CSS, Zustand state, HashRouter routes, framer-motion transitions, `@tanstack/react-virtual` for long lists. |
| Wish Card | `src/wishcard/` — tiers, themes, copy, caption, layout, canvas renderer, QR, share and UI; lazy-loaded only when a result exists. |
| Deployment | Static `dist/` on GitHub Pages; no server process, no secrets, no runtime network calls beyond same-origin data. |

## Verification results (final run)

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | clean |
| Typecheck | `npm run typecheck` (`tsc -b --noEmit`) | clean, 0 errors |
| Unit + integration | `npm test` (`vitest run`) | **155/155 passed** (16 files) |
| Production build | `npm run build` | success in 4.29s |
| End-to-end | `npm run test:e2e` | **48/48 passed** (1 worker, chromium) |
| Wish-card E2E | `npm run test:e2e:wish` | **19/19 passed** (1 worker, chromium) |
| Local smoke | `npm run smoke:local` | **RESULT: PASS** — 21 checks (18 required + 3 soft), 0 console errors, 0 failed requests |

All seven gates were run sequentially, one at a time, under
`systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0`.

### Production hardening verification

The Section 10.1 caveats in the PRD are resolved and covered by focused checks:

- **Verified cache writes:** `ChunkLoader` checks byte length and WebCrypto
  SHA-256 before calling `cachedFetcher().onVerified`; corrupt cached bytes call
  `onCorruptCached`, delete their IndexedDB key and surface the
  `ChunkIntegrityError`. Unit coverage in
  `tests/unit/browser/chunkLoader.test.ts` includes bounded WASM residency,
  corrupt cached-entry eviction and rejection of corrupt network bytes.
- **Bounded WASM residency:** the loader's LRU eviction hook drives
  `WasmChunkResidency`; full scans pin every chunk for `require_all()`, then drop
  non-LRU chunks when the last job ends via `PiEngine.drop_chunk()`.
- **Pattern implementation:** `search_pattern()` now dispatches to the
  parity-tested Shift-And `search_pattern_optimized()`; the direct scan remains
  the reference. `cargo test -p pi-core pattern`, `npm run test:wasm`,
  `PI_PARITY_PHASE=pattern` (8 assertions) and both browser E2E suites pass.
- **Social unfurls:** a Vite `transformIndexHtml` plugin rewrites `og:image` and
  `twitter:image` to absolute HTTPS URLs from `VITE_SITE_URL`, with the canonical
  GitHub Pages root as fallback. The built `dist/index.html` was inspected and
  both tags contain `https://samdanisayam.github.io/pi-atlas/og.png`.

### 1B local preview verification

A dedicated build used `VITE_PI_DATASET_URL=data/pi-1b/` and the smoke run used
`SMOKE_EXPECT_DIGITS=1000000000`; the manifest reported exactly
1,000,000,000 digits and **RESULT: PASS** with 0 console errors and 0 failed
requests. Chromium was launched with `--disable-dev-shm-usage` so the 5 MB packed
chunks could spill to disk instead of exhausting `/dev/shm`.

| Soft metric | Measured value |
| --- | --- |
| `first-result-time` | **11,940 ms** (WARN over 5,000 ms) |
| `data-transfer` | **1.48 MB / 1,547,920 B** counted by page-level CDP (WARN over 60 MB) |
| `memory-hint` | **227.9 MB** `usedJSHeapSize` |
| `shapes-preset` | **58,869 ms** (required check passed, noted “slow” over 20 s and under the 60 s limit) |

The WARN statuses are expected for a cold 1B scan and do not fail smoke. The
smoke byte counter observes page-level `Network.loadingFinished` events, so
worker chunk fetches are undercounted; 1.48 MB is the measured smoke value, not
the ~478 MB raw dataset size. The final default `dist/` was rebuilt for the 2M
dataset after this verification.

### Wish Card redesign verification

- All four tiers verified end-to-end (query, heading, pill, quote) on the local
  2M dataset: gold `141592653`, silver `1415926`, aurora `12`, twilight a
  guaranteed-absent 20-digit string.
- All three PNG formats downloaded with exact file names and under budget:
  Square **67,957 B**, Story **89,626 B**, Wide **47,439 B** (limits
  1.5 / 2.2 / 1.0 MB), measured by the final smoke run against the production
  build for the same `q=12` card. The flat archival plate removed gradients,
  glow and grain, so every format sits far below its limit.
- Bundle budgets: main chunk **72.23 KB gzip** (within the +0.5 KB growth limit)
  and Wish Card chunk **20.00 KB gzip** (limit 45 KB).
- Dev gallery: 30 cards, one full-size canvas alive at a time, every card
  passing QR decode, margins, text size, story safe zone, overlap, QR overlap
  and colour-family checks; contact sheet at
  `smoke-report/wish-contact-sheet.png` (1216×2211).
- Final polish verified visually in the gallery: lowercase `π ATLAS`, empty
  context strips, sharp ivory QR plates with centred footers, and no repeated
  Uncharted prefix in the factual line.
- `dist/` contains no `dev/wish` string.

### Dataset verification

- Manifest `total_digits = 2,000,000` for the local test build; the deployed
  build serves the 1B dataset. `verify:pi` re-checks the 2M fixture.
- Checkpoints: `12` first at decimal position **148**, `999999` at **762**
  (1-based, overlapping matches, no leading `3`).
- SHA-256 of `public/pi-2m.txt`:
  `efcbafbaf15047f32f70d8b1b008bac527e9f76d4d4b995d7f36dfd6dd8dc7ed`.
- 1B digits generated with y-cruncher (Chudnovsky formula); first two million
  decimals checked byte-for-byte against the fixture with mpmath.

## Deliverables

| Item | Location |
| --- | --- |
| Source | `src/` (pages, `data/`, `engine/`, `generated/pi-wasm/`, `workers/`, components, tour, stores, `wishcard/`) |
| Verified dataset | `public/data/pi-1b/` + manifest (production); `public/data/pi-2m/` + manifest (local/CI); `public/pi-2m.txt` + `public/pi-2m.sha256` |
| Dataset tooling | `scripts/pack_dataset.py`, `scripts/verify_pi.py` |
| Social card | `public/og.png` via `npm run generate:og` |
| Product spec | `PRD.pdf`, generated from `PRD.html` by `npm run make:prd` |
| Docs | `README.md`, `DECISIONS.md`, this report |
| Licence | `LICENSE` (MIT) |

## Performance and budgets

- Cold dataset fetch → manifest validation → SHA-256 is fast on the local build;
  a fresh browser context can take longer under heavy machine IO contention.
  No network request leaves the origin.
- Pattern scans over millions of cells run in a Web Worker with progress and
  cancellation; the UI stays interactive.
- The digit field is row-virtualised and occurrence lists are windowed; the
  minimap samples rather than rendering every cell.
- Measured gzip sizes: main chunk 72.23 KB, Wish Card chunk 20.00 KB, Explore
  25.99 KB, Home 42.60 KB, CSS 7.20 KB, WASM 86.60 KB. Fonts are self-hosted
  woff2. Total data transferred during smoke: 1.12 MB on the default local 2M
  build and 1.48 MB in the separate 1B preview verification.
- PNG budgets are enforced in E2E and smoke; the flat archival plate brings
  every format well under its limit without reducing digit texture.

## Accessibility

Skip link (router-safe), ARIA live regions for search results, keyboard pattern
painting, visible focus, focus traps and Escape for dialogs/sheets,
reduced-motion support, 4.5:1 contrast in both themes, semantic landmarks,
mobile bottom navigation. Verified by dedicated E2E tests (keyboard navigation,
responsive sweep, axe checks on the wish-card dialog and shared banner).

## Deployment

Static `dist/` — any host works; no rewrites are needed because of hash
routing. The GitHub Pages workflow deploys only when
`PI_ATLAS_PAGES_DEPLOY=true`; its `PI_ATLAS_DATASET_URL` variable is baked into
the deploy build as `VITE_PI_DATASET_URL` (default `data/pi-2m/`, set to
`data/pi-1b/` for the full site). `VITE_SITE_URL` supplies the canonical root for
Wish Card links and absolute social-preview images. Build with
`npm run build`, publish `dist/`. See `docs/GITHUB_PAGES_DEPLOYMENT.md` and
`docs/BROWSER_SEARCH_ARCHITECTURE.md` for details; `DEPLOY.md` is retained as an
older server-based setup with a current-pipeline note. `VITE_*` variables are
embedded in public JavaScript and must never contain secrets.

## Known limitations

- Normality of π is unproven; odds are labelled as an idealised model, not a
  claim.
- Letter search caps words at 12 letters; pattern scans are bounded by the
  painted cell count. Limits are documented in the UI.
- The 1B dataset is large; first load cost is dominated by same-origin chunk
  transfer and verification on slower connections.
- The brief's illustrative digit-length tier boundaries conflict with the
  engine's actual `(N−L+1)/10^L` expected-count curve. The exact threshold rules
  are authoritative and the discrepancy is recorded in `DECISIONS.md` (W-D19).
- Real-device testing (Android/iOS), Lighthouse scores, foldable postures and
  virtual-keyboard occlusion were not available in this environment; browser
  checks use headless Chromium.

## Change history

1. **2M prototype** — five explorers, tour, odds lab, verified fixture, first
   PNG export, mobile-first responsive engineering.
2. **1B dataset** — WASM engine in a worker, chunked/manifest data layer, static
   deployment on Pages.
3. **Shared-link banner** — `src=card` on QR payloads only; deep links and
   captions unchanged.
4. **Wish Card redesign** — rarity tiers, emotional copy, collectible default,
   clean legacy style, Latin-only dedications, size budgets, one-at-a-time
   gallery, this report and the PRD.
5. **Production hardening** — verified-before-write IndexedDB caching, bounded
   WASM chunk residency, Shift-And pattern dispatch, absolute social images,
   focused hardening tests and 1B preview verification.

All design trade-offs are recorded as decision IDs in [DECISIONS.md](DECISIONS.md).
