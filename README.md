# π Atlas

An interactive atlas of the first **1,000,000,000 decimal digits of π**. Search
for numbers, dates, words, colours and shapes hidden in the stream — and see
what probability says about what you will (and won't) find.

The browser never holds the dataset. A local **Rust search service** owns the
packed digits and answers searches as async jobs (with real progress,
cancellation and deadlines); the React client renders only the small digit
windows it is currently showing. Odds and difficulty maths stay client-side.

## Highlights

- **Five explorers** — Digits, Dates, Letters, Colours, Shapes — all computed
  server-side from the single canonical dataset, with live progress.
- **Probability Laboratory** — feel the cliff between "everywhere" and
  "practically impossible" before you search.
- **Guided tour** — four acts, each running a real search against the service.
- **Shareable deep links** — every search lives in the URL.
- **Accessible** — keyboard painting, ARIA live regions, skip links, reduced
  motion support, 4.5:1 contrast.
- **Mobile-first** — below 768px a compact header, fixed bottom navigation and
  bottom sheets replace the desktop layout (desktop unchanged); no horizontal
  overflow from 280px to 1920px, portrait and landscape
  (`tests/e2e/responsive.spec.ts`).
- **Honest numbers** — odds are a clearly labelled idealised model, not proof
  of anything; every count on screen comes from a real scan.

## The dataset

One packed artifact, `pi-atlas-packed-v1`: digits after the decimal point only
(no leading `3`), 4 bits per digit, chunked into binary files with a
`manifest.json` carrying per-chunk and whole-file SHA-256 checksums, first
digits, and checkpoints (`12` first at 148, `999999` at 762). Positions are
1-based decimal positions; matches overlap. The service verifies every
checksum at startup and refuses to serve on any mismatch.

The 1B digits were produced with y-cruncher (Chudnovsky formula); the first
two million decimals were additionally checked byte-for-byte against the
independently computed `public/pi-2m.txt` (mpmath, dual precision). The 2M
fixture stays in the repo as the parity reference for the search engines and
the E2E suite.

```bash
python3 scripts/pack_dataset.py <decimal.txt> <out-dir>   # pack + verify
npm run verify:pi                                          # re-verify the 2M fixture
```

## Development

```bash
# 1. Build and run the search service (Rust, service/)
cd service && cargo build --release -p pi-server
PI_ATLAS_DATA=/home/megalith/pi-atlas-build/data-2m PI_ATLAS_ADDR=127.0.0.1:7787 \
  ./target/release/pi-server

# 2. React app (proxies /api → 127.0.0.1:7787; override with PI_ATLAS_API)
npm install          # Node 20+
npm run dev
```

### Checks

```bash
npm run typecheck    # tsc -b --noEmit
npm test             # Vitest unit + integration (80 tests)
npm run test:e2e     # Playwright: serves the production build on :4174,
                     # starts the service on :7787 against the 2M pack
                     # (run npm run build first if you changed source)
npm run build        # typecheck + production build into dist/
```

E2E expectations are pinned to the 2M pack (e.g. `12` → 19,800 occurrences).
Measured service timings at 1B: exact scan ~1.6–1.8 s, letters ~3.1 s, dates
~6.5 s, stats ~1.3 s, pattern ~6 s — all with live progress, cancellable.

## Deployment

The public app is a **static frontend on GitHub Pages** plus a **Rust search
API on a small VPS behind HTTPS**. The browser never holds the dataset: it
calls the API for jobs and fetches only the digit windows it displays. This is
why the site works at 1B digits without a CDN for the data.

```
GitHub Pages (static dist/)  ──HTTPS──▶  Caddy (TLS)  ──▶  pi-server (loopback)
   https://<user>.github.io/pi-atlas/      api.example.com      127.0.0.1:7787
                                                                    │
                                                      packed 1B dataset (outside Git)
```

**Production URL (once deployed):** `https://<user>.github.io/pi-atlas/`
(replace `<user>` with the GitHub account that owns the repository).

### Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_PI_ATLAS_API` | build time (repo Variable `PI_ATLAS_API_URL`) | Full API root used by the browser, e.g. `https://pi-atlas.example.com/api/v1`. Public endpoint config, **not a secret**. Unset → same-origin `/api/v1` (local dev). |
| `VITE_BASE_PATH` | build time | Vite base path. Defaults to `./` (correct for a GitHub Pages project site). |
| `window.__PI_ATLAS_API__` | runtime, browser | Optional runtime override that wins over the build-time value. |
| `PI_ATLAS_DATA` | server | Packed dataset directory (manifest.json + chunks/). Required. |
| `PI_ATLAS_ADDR` | server | Listen address. Localhost in production (`127.0.0.1:7787`); Caddy is the only public entry. |
| `PI_ATLAS_CORS_ORIGINS` | server | Comma-separated browser origins allowed by CORS. Default: local dev origins only. Set to the exact Pages origin in production. `*` is dev-only. |
| `PI_ATLAS_MAX_CONCURRENT` | server | Concurrent scans (default 4) — bounds memory/CPU under load. |
| `PI_ATLAS_TIMEOUT_SECS` | server | Per-job deadline (default 300). |
| `PI_ATLAS_CACHE_ENTRIES` / `PI_ATLAS_CACHE_TTL_SECS` | server | Result cache size/lifetime (256 / 600s). |

No secrets are used by the frontend; never put a token in a `VITE_*` variable
— Vite embeds those values in the public JavaScript bundle.

### Frontend (GitHub Pages)

Push to `main`: `.github/workflows/deploy.yml` installs from `package-lock.json`,
runs typecheck, unit tests, regenerates the 2M test pack from
`public/pi-2m.txt`, builds the Rust service, builds the frontend, runs the full
E2E suite against the real service on alternate ports (4175/7788), verifies no
localhost references remain in `dist/`, and only then deploys to Pages.

HashRouter (`#/…`) keeps direct navigation and page refresh working on Pages
without server rewrites; Vite's relative `base` keeps every asset loading from
the `/pi-atlas/` subpath. To deploy manually:

```bash
npm ci && npm run typecheck && npm test && npm run build
# upload dist/ to Pages (Actions does this automatically)
```

### Backend (user-owned VPS)

GitHub Pages cannot run a long-lived Rust process. The dataset and its indexes
stay **outside Git** on a small Always-Free/low-cost VPS. Full commands, sizing
(1–2 vCPU, 2 GB RAM, ~10 GB disk for the 1B pack + headroom, ~1 Mbps sustained
egress), HTTPS/Caddy setup, systemd, dataset packing and a verification
checklist are in **[DEPLOY.md](DEPLOY.md)**. The service streams the packed
digits (measured ~3 MB RSS at 1B digits), so a €0–5/month machine is plenty.

The service enforces a 64 KB request body limit, per-job deadlines, bounded
concurrency, explicit CORS allowlist, JSON error responses and graceful
shutdown on SIGTERM. Health endpoint: `GET /api/v1/health`.

For social previews, either host `og.png` at an absolute URL or accept the
relative `og:image` (some crawlers require an absolute URL — see DEPLOY.md).

### Keeping the local demo intact

Local development uses `npm run dev` (proxy → `127.0.0.1:7787`) and the pinned
demo preview on **4174 → 1B service on 7780**. Production uses completely
separate ports and origins; the workflow and verification always use 4175/7788.

## Project layout

```
service/               Rust search service (crates/server, crates/core)
public/
  pi-2m.txt            2M-digit parity fixture (engines + E2E reference counts)
scripts/
  pack_dataset.py      packer + verifier for pi-atlas-packed-v1
src/
  data/piApi.ts        typed client for the service (jobs, windows, stats)
  data/digitWindow.ts  on-demand digit windows (2 KB buckets, LRU cache)
  data/piStore.ts      manifest-only store (size, format, checksums)
  state/useSearch.ts   async submit → poll → convert; odds maths client-side
  engine/              pure engines kept as parity references (test fixtures)
  pages/               Home, Explore (5 modes), OddsLab, About
  tour/                guided tour (4 acts, live searches)
src/constants.ts       central facts (no dataset size — it comes from the manifest)
```

## Licence

MIT — see `LICENSE`.
