# π Atlas

An interactive atlas of the first **1,000,000,000 decimal digits of π**. Search
for numbers, dates, words, colours and shapes hidden in the stream, see what
probability says about what you will (and won't) find, and turn any finished
result into a rarity-tiered **Wish Card** PNG.

The whole app runs on the device. A local WASM engine in a Web Worker scans
same-origin static digit chunks: `public/data/pi-2m/` is the local/CI default,
and the full `public/data/pi-1b/` set is selected at build time for production.
There is no backend, no paid service and no upload. Odds and difficulty maths
stay client-side, and every count on screen comes from a real scan.

## Highlights

- **Five explorers** — Digits, Dates, Letters, Colours, Shapes — with live
  progress, cancellation and honest model estimates.
- **Wish Cards** — a collectible, rarity-tiered PNG for every finished search
  (found or not), generated locally with a scannable QR code. Four tiers:
  Legendary, Rare, Lucky and Twilight. See [Wish cards](#wish-cards).
- **Probability Laboratory** — feel the cliff between "everywhere" and
  "practically impossible" before you search.
- **Guided tour** — four acts, each running a real search.
- **Shareable deep links** — every search lives in the URL; old links keep
  working unchanged.
- **Accessible** — keyboard painting, focus traps, ARIA live regions, skip
  links, reduced motion support, 4.5:1 contrast.
- **Mobile-first** — compact header and bottom sheets below 768px; no
  horizontal overflow from 280px to 1920px
  (`tests/e2e/responsive.spec.ts`).

## The dataset

Digits after the decimal point only (no leading `3`), 4 bits per digit, chunked
into binary files under `public/data/pi-2m/` and `public/data/pi-1b/`, each with
`web-manifest.json` (browser) and `core-manifest.json` (WASM) carrying per-chunk
and whole-file SHA-256 checksums. Positions are 1-based decimal positions;
matches overlap. The app validates the web manifest and each chunk's checksum at
startup; the whole-file digest is checked by the dataset scripts. The build-time variable `VITE_PI_DATASET_URL` selects the dataset root
(default `data/pi-2m/`); the CI variable `PI_ATLAS_DATASET_URL` is mapped to it,
and production uses `data/pi-1b/`.

The 1B digits were produced with y-cruncher (Chudnovsky formula); the first two
million decimals were checked byte-for-byte against `public/pi-2m.txt`
(mpmath, dual precision). The 2M fixture stays in the repo as the parity
reference for the pure TypeScript engines and as the dataset used by local
tests.

```bash
python3 scripts/pack_dataset.py --input <decimal.txt> --output-dir <out-dir>   # pack + verify
npm run verify:pi                                          # re-verify the 2M fixture
```

## Wish cards

After any finished Digits, Letters, Colours or Shapes search, the result gets a
**Your wish card** section with a live preview, **Download**, **Share** and
**Customize**. The card is tiered from the real search statistics:

| Tier | Condition (found search) | Zone-2 label / heading | Palette |
| --- | --- | --- | --- |
| **Legendary** (gold) | `expected < 0.01` | `LEGENDARY · 1 IN N` / "You earned a Legendary card" | royal gold |
| **Rare** (silver) | `0.01 ≤ expected < 1` | `RARE · 1 IN N` / "You earned a Rare card" | royal silver |
| **Lucky** (aurora) | `expected ≥ 1` | `LUCKY FIND` / "You earned a Lucky card" | royal aurora |
| **Twilight** | query not found | `UNCHARTED` / "You earned a Twilight card" | royal twilight |

`expected` is the engine's expected number of occurrences for a search of that
length. The thresholds are exact: `TIER_THRESHOLDS = { gold: 0.01, silver: 1 }`.
A non-finite or non-positive `expected` is treated as `1` (Lucky), without a
log — a bad statistic can never invent a rare card. The zone-2 label uses the
same at-least-one probability as the odds line, grouped as an integer.

**Odds and honesty.** One-in-N odds use the at-least-one probability
`P = 1 − exp(−expected)`, `Math.round(1 / P)`, rendered in plain English (e.g.
"1 in 1 million"); they are shown on Legendary and Rare cards only. Every card
prints the exact fine print `Odds assume random digits · Statistics, not magic.`
Headlines, sublines, odds and quotes are checked against an honesty word list;
the only sourced attribution is `by: "David Hilbert, 1930"` and no self-attributed
card quotes or italic fonts are used. Copy pools are calm and deterministic per
search, so a query always produces the same card. Uncharted cards do not repeat
the tier name in the factual line, and an absent context strip is left empty.

**Customize dialog.**

- Three formats: **Square** 1080×1080 (≤1.5 MB), **Story** 1080×1920 (≤2.2 MB),
  **Wide** 1200×630 (≤1.0 MB).
- Two styles of the same Royal Observatory Plate: **collectible** (default,
  tier palettes) and **clean** (Archival Ivory Parchment). The old `paper` palette is gone.
- **Hide my digits** removes the query from the card, context strip, QR URL,
  caption and filename (`slug` becomes `hidden`). Date-helper searches turn it
  on by default and show a privacy note.
- **Dedication** accepts Latin letters (including accents), digits, spaces and
  `. - ’ & ,`, collapses whitespace, trims and caps at 24 characters. The hint
  is "Latin letters only for now". It appears on the card and in the caption,
  never in the QR URL or filename.
- **Copy caption** builds a tier-aware share caption with the `#PiAtlas #pi`
  hashtags.

**Rendering and sharing.** Everything is drawn with canvas 2D on the device:
fonts, a flat five-zone archival plate with a hairline frame and registration
ticks, tier palettes, region pixels and the QR code (`qrcode` modules are drawn
as integer squares on a sharp Archival Ivory plate). There are no gradients,
glows, sparkles or rounded hero plates, and no emoji in canvas text. The footer
text block is centred on the QR plate, an empty context strip stays empty, and
the wordmark keeps the Greek `π` lowercase. No images are downloaded and no
data leaves the browser. Edition tags (e.g. `EDITION · 2M`) and size wording
come from the loaded manifest, never a hardcoded value. File names follow
`pi-atlas-wish-{mode}-{slug}-{format}.png`.

The QR payload alone carries `src=card`. Scanning it opens the same search with
a small "Someone found … in π" banner; Copy link and captions never carry the
marker, so old links keep behaving exactly as before. Very long links fall back
to the mode's query-free explorer URL so the plate stays scannable. QR plates
are fixed: square `{x:836,y:836,size:172}`, collectible story
`{x:72,y:1330,size:220}`, wide `{x:872,y:120,size:220}`, clean story
`{x:410,y:1300,size:260}`.

The feature loads as a lazy chunk only when a result exists. Final measured
sizes: main bundle **72.23 KB gzip** (within the +0.5 KB growth limit) and
wish-card chunk **20.00 KB gzip** (limit 45 KB). Measured PNG sizes for `q=12`
in the final smoke run: Square **67,957 B**, Story **89,626 B**, Wide **47,439 B**
— all under budget (1.5 / 2.2 / 1.0 MB).

### Branding

Set these in `src/constants.ts`:

| Constant | How to change |
| --- | --- |
| `BRAND_HANDLE` | Edit the empty string in `src/constants.ts`. When non-empty it is drawn in the card footer. |
| `SITE_URL` | Set the `VITE_SITE_URL` build variable to the canonical HTTPS site root (no trailing slash needed). It drives Wish Card QR/caption/filename logic and the build-time `og:image`/`twitter:image` URLs; when unset it falls back to `location.origin + location.pathname` at runtime and the canonical Pages root in the social tags. |
| `BRAND_TAGLINE` / `BRAND_HASHTAG` | Also in `src/constants.ts`. |

### Dev gallery

The gallery renders **30 cards** covering all four tiers, three formats, both
styles and hidden-query cases. Each full-size card is drawn **one at a time**,
its QR decoded locally with `jsqr`, and checked for margins, minimum text size,
story safe zone, text overlap, QR overlap and tier colour family; its canvas is
then freed (`canvas.width = 0`) before the next card. Never more than six
full-size canvases are alive. A contact sheet is written to
`smoke-report/wish-contact-sheet.png`.

```bash
npm run dev      # then open http://localhost:5173/#/dev/wish
# or
npm run test:e2e:wish    # starts Vite with VITE_E2E=1 and runs the wish E2E suite
```

The route is compiled only when `import.meta.env.DEV` or `VITE_E2E` is set;
`dist/` from a production build contains no `dev/wish` string.

## Development

```bash
npm install                  # Node 20+
npm run dev                  # Vite dev server on :5173
```

### Checks

```bash
npm run lint                 # placeholder markers, console.log, trailing whitespace
npm run typecheck            # tsc -b --noEmit
npm test                     # Vitest unit + integration (155 tests, 16 files)
npm run build                # typecheck + production build into dist/
npm run test:e2e             # Playwright: 48 tests against the production preview
npm run test:e2e:wish        # Playwright: 19 tests against the dev server + gallery
npm run smoke:local          # read-only sequential smoke walk over dist/
```

Memory note: run heavy commands under the machine's cap, e.g.
`systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 npm run build`,
and never run two heavy commands at once. Use Playwright Chromium with one
worker for browser tests.

### Data-path hardening

Chunk bytes are verified for length and SHA-256 before the persistent cache is
written. A cached chunk that fails verification is deleted and the error is
propagated, so the next attempt fetches from the network. WASM copies are bounded
by a per-job residency coordinator: full scans pin every chunk only for the
duration of `require_all()`, then drop all non-LRU chunks through
`PiEngine.drop_chunk()`. Pattern searches use the parity-tested Shift-And
implementation. These behaviors are covered by unit tests in
`tests/unit/browser/chunkLoader.test.ts`, Rust tests, `npm run test:wasm` and
pattern parity.

### 1B preview verification

Built with `VITE_PI_DATASET_URL=data/pi-1b/` and verified with
`SMOKE_EXPECT_DIGITS=1000000000`, the local preview reported exactly
1,000,000,000 digits and `RESULT: PASS` (0 console errors, 0 failed requests):

| Metric | Value |
| --- | --- |
| `first-result-time` | 11,940 ms (soft WARN over 5 s) |
| `data-transfer` | 1.48 MB / 1,547,920 B counted by page-level CDP |
| `memory-hint` | 227.9 MB JS heap |
| `shapes-preset` | 58,869 ms (required check passed, “slow” over 20 s) |

The byte counter sees page-level `Network.loadingFinished` events, so worker
chunk fetches are undercounted; this is not the raw dataset size. The final
default `dist/` was rebuilt against 2M after the 1B run.

## Pre-deploy smoke test

A read-only, sequential Playwright walk over the built app. It writes
`smoke-report/report.md` and `smoke-report/report.json` and exits 0 only when
every REQUIRED check passes (SKIP and WARN never fail the run). The 21 checks
comprise 18 REQUIRED and 3 WARN-only checks.

```bash
npm run smoke:local
# builds dist/ if it is missing or older than the source, starts `vite preview`
# on a free port, runs the checks, and always stops the server afterwards.

SMOKE_BASE_URL=https://user.github.io/pi-atlas/ npm run smoke:live
# SMOKE_BASE_URL is required; without it the command prints a clear message and
# exits 2. Nothing is deployed by either command.
```

The runner waits for focus after “Search your own” and launches Chromium with
`--disable-dev-shm-usage`, which keeps the 1B scan from crashing on `/dev/shm`
limits.

Optional environment variables:

- `SMOKE_EXPECT_DIGITS=1000000000` — assert the app manifest's `total_digits`
  equals this value (otherwise any positive integer passes).
- `SMOKE_SKIP=check1,check2` — comma-separated check names to mark as SKIP.
  Handy for baselining an older live build that lacks newer features (for
  example `SMOKE_SKIP=wishcard-qr-host,banner-from-qr`). SKIP does not count as
  a failure.

Known-harmless failed requests can be allow-listed by editing
`ALLOW_FAILED_REQUESTS` at the top of `scripts/smoke/smoke.mjs` (empty by
default). Each entry is a regular expression matched against
`<url> <failure>` or `<status> <url>`; leave the list empty unless you have
confirmed a request is benign.

Checks (REQUIRED unless marked WARN):

| Check | What it verifies |
| --- | --- |
| `home-loads` | Home returns 200, has the app title and shows the hero. |
| `no-console-errors` | Zero console errors and page errors across the whole run. |
| `no-failed-requests` | No failed or ≥400 request outside the allow-list. |
| `manifest-ok` | Manifest loads, `total_digits` is a positive integer (and matches `SMOKE_EXPECT_DIGITS` when set), and the About page shows the same size. |
| `digits-12` | Digits search `12` → first position exactly 148. |
| `digits-feynman` | Digits search `999999` → first position exactly 762. |
| `digits-not-found` | A 20-digit search renders a found/not-found result without crashing. |
| `letters-pi` | Letters search `PI` is found. |
| `shapes-preset` | Plus preset + search produces a result within 60 s (required; detail notes "(slow)" over 20 s). |
| `deep-link-roundtrip` | The share link for `12` restores position 148 in a fresh context. |
| `wishcard-download` | Found and not-found cards in all three formats: exact file names, correct headers, each under its PNG budget (1.5 / 2.2 / 1.0 MB). |
| `wishcard-tiers` | All four tier headings and pills render; query lengths are derived from the manifest's `total_digits` so the check works on both 2M and 1B builds. |
| `wishcard-qr-host` | The card QR decodes with `jsqr`, has the test origin and contains `src=card`. |
| `banner-from-qr` | The QR URL shows the shared-result banner with position 148; "Search your own" clears it and focuses the input. |
| `wishcard-fonts` | `document.fonts.check` is true for Fraunces/Inter/JetBrains Mono and every CSS font file returns HTTP 200. |
| `wishcard-hide-digits` | Date-helper card with "Hide my digits": QR and caption contain none of the six date strings. |
| `mobile-layout` | At 390×844, Home, Digits, Shapes, Odds Lab, About, the card dialog and the banner have no horizontal overflow. |
| `prod-hygiene` | No `dev/wish` gallery in a production build (or on the live site). |
| `first-result-time` (WARN) | Time to the first digits result; WARN over 5 s. |
| `data-transfer` (WARN) | Total bytes transferred; WARN over 60 MB. |
| `memory-hint` (WARN) | End-of-run `performance.memory.usedJSHeapSize`, when available. |

**Polite live use:** `smoke:live` is strictly normal, read-only browsing —
sequential steps, at most about 60 page navigations, no load testing, and it
never asks the app to fetch data chunks it would not load on its own. Do not
run it in parallel or against a live site you do not control without permission.

## Deployment

Pure static site on GitHub Pages. The browser loads the WASM engine and the
same-origin digit chunks; no server process is involved.

`https://samdanisayam.github.io/pi-atlas/` ·
`https://github.com/SamdaniSayam/pi-atlas`

The Pages workflow deploys only when `PI_ATLAS_PAGES_DEPLOY=true` is set. Its
`PI_ATLAS_DATASET_URL` variable is baked into the deploy build as
`VITE_PI_DATASET_URL` (default `data/pi-2m/`; set it to `data/pi-1b/` for the
full 1B site). `VITE_SITE_URL` is also supplied to every build so Wish Card links
and the build-time social image tags use one canonical root. HashRouter (`#/…`)
keeps direct navigation and refresh working on Pages without rewrites; Vite's
relative `base` keeps assets loading from the `/pi-atlas/` subpath. See
[docs/GITHUB_PAGES_DEPLOYMENT.md](docs/GITHUB_PAGES_DEPLOYMENT.md),
[docs/BROWSER_SEARCH_ARCHITECTURE.md](docs/BROWSER_SEARCH_ARCHITECTURE.md),
[REPORT.md](REPORT.md), [PRD.pdf](PRD.pdf) and [DECISIONS.md](DECISIONS.md).
`DEPLOY.md` documents an older server-based deployment and is kept for history.

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SITE_URL` | build time | Canonical HTTPS root for wish-card QR/caption/filename logic and absolute `og:image`/`twitter:image` URLs; defaults to the Pages root. |
| `VITE_BASE_PATH` | build time | Vite base path, defaults to `./`. |
| `VITE_PI_DATASET_URL` | build time | Dataset root, defaults to `data/pi-2m/`; the full site uses `data/pi-1b/`. |
| `VITE_E2E` | build time | Enables the dev-only wish gallery route in E2E builds. |
| `PI_ATLAS_PAGES_DEPLOY` | CI | Pages deploy guard. |
| `PI_ATLAS_DATASET_URL` | CI | Source for `VITE_PI_DATASET_URL` in the deploy build. |

No secrets are used by the frontend; never put a token in a `VITE_*` variable —
Vite embeds those values in the public JavaScript bundle.

## Project layout

```
public/data/pi-1b/          same-origin 1B dataset chunks + manifest (production)
public/data/pi-2m/          same-origin 2M dataset chunks + manifest (local/CI default)
public/pi-2m.txt            2M-digit parity fixture
src/
  data/                     WASM backend client, verified cache, residency manager
  engine/                   pure engines kept as parity references + formatters
  generated/pi-wasm/        committed WASM bindings (no Rust in CI)
  lib/socialMetadata.ts     build-time absolute social image URL resolution
  pages/                    Home, Explore (5 modes), OddsLab, About
  wishcard/                 tiers, themes, copy, renderer, QR, share, UI
  wishcard/dev/             dev-only gallery with local QR decoding
  constants.ts              central facts, branding, SITE_URL
scripts/lint.mjs            dependency-free lint used by npm run lint
scripts/make_prd.mjs        npm run make:prd: PRD.html → PRD.pdf with Chromium
tests/unit/                 Vitest unit + integration
tests/e2e/                  Playwright against the production build
tests/e2e-wish/             Playwright against the dev server + gallery
```

## Licence

MIT — see `LICENSE`.
