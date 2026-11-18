# π Atlas

An interactive atlas of the first **1,000,000,000 decimal digits of π**. Search
for numbers, dates, words, colours and shapes hidden in the stream, see what
probability says about what you will (and won't) find, and turn any finished
result into a shareable **Wish Card** PNG.

The whole app runs on the device. A local WASM engine in a Web Worker scans the
same-origin static digit chunks served from `public/data/pi-1b/`; there is no
backend, no paid service and no upload. Odds and difficulty maths stay
client-side, and every count on screen comes from a real scan.

## Highlights

- **Five explorers** — Digits, Dates, Letters, Colours, Shapes — with live
  progress, cancellation and honest model estimates.
- **Wish Cards** — a branded PNG for every finished search (found or not),
  generated locally with a scannable QR code. See below.
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
into binary files under `public/data/pi-1b/` with a `manifest.json` carrying
per-chunk and whole-file SHA-256 checksums. Positions are 1-based decimal
positions; matches overlap. The app verifies the manifest at startup.

The 1B digits were produced with y-cruncher (Chudnovsky formula); the first two
million decimals were checked byte-for-byte against `public/pi-2m.txt`
(mpmath, dual precision). The 2M fixture stays in the repo as the parity
reference for the pure TypeScript engines.

```bash
python3 scripts/pack_dataset.py --input <decimal.txt> --output-dir <out-dir>   # pack + verify
npm run verify:pi                                          # re-verify the 2M fixture
```

## Wish cards

After any finished Digits, Letters, Colours or Shapes search, the result gets a
**Your wish card** section with a 240 px live preview, **Download**, **Share**
and **Customize**. The Customize dialog offers three formats (Square
1080×1080, Story 1080×1920, Wide 1200×630), two fixed palettes (Night, Paper),
a **Hide my digits** switch, and Copy caption.

- Everything is drawn with canvas 2D on the device: fonts, sparkles, texture,
  region pixels and the QR code (`qrcode` modules are drawn as integer squares).
  No images are downloaded and no data leaves the browser.
- Dataset-size wording (e.g. "1 billion digits") comes from the loaded manifest,
  not a hardcoded string, so a different dataset updates every card.
- The QR opens the exact deep link for that search. Very long links fall back
  to the mode's query-free explorer URL so the plate stays scannable.
- **Hide my digits** removes the query from the card, context strip, QR URL,
  caption and filename (`slug` becomes `hidden`). Date-helper searches turn it
  on by default and show a privacy note.
- The feature loads as a lazy chunk only when a result exists; the main bundle
  grew by ~0.4 KB gzip and the wish-card chunk is ~20 KB gzip.

### Branding

Set these in `src/constants.ts`:

| Constant | How to change |
| --- | --- |
| `BRAND_HANDLE` | Edit the empty string in `src/constants.ts`. When non-empty it is drawn in the card footer. |
| `SITE_URL` | Set the `VITE_SITE_URL` build variable to the canonical site root (no trailing slash needed). If unset it falls back to `location.origin + location.pathname`. |
| `BRAND_TAGLINE` / `BRAND_HASHTAG` | Also in `src/constants.ts`. |

### Dev gallery

The gallery renders 24 core cards plus Paper and hidden-query examples with
layout boxes, and decodes each QR locally with `jsqr`.

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
npm test                     # Vitest unit + integration (117 tests)
npm run build                # typecheck + production build into dist/
npm run test:e2e             # Playwright: production preview on :4174 (build first)
npm run test:e2e:wish        # Playwright: dev server on :4175 with the gallery
```

Memory note: run heavy commands under the machine's cap, e.g.
`systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 npm run build`,
and never run two heavy commands at once.

## Deployment

Pure static site on GitHub Pages. The browser loads the WASM engine and the
same-origin digit chunks; no server process is involved.

`https://samdanisayam.github.io/pi-atlas/` ·
`https://github.com/SamdaniSayam/pi-atlas`

The Pages workflow deploys only when `PI_ATLAS_PAGES_DEPLOY=true` is set and
uses `PI_ATLAS_DATASET_URL=data/pi-1b/`. HashRouter (`#/…`) keeps direct
navigation and refresh working on Pages without rewrites; Vite's relative
`base` keeps assets loading from the `/pi-atlas/` subpath. See
[DEPLOY.md](DEPLOY.md) and [DECISIONS.md](DECISIONS.md) for the full history.

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SITE_URL` | build time | Canonical root used by wish-card QR/caption/filename logic. |
| `VITE_BASE_PATH` | build time | Vite base path, defaults to `./`. |
| `VITE_E2E` | build time | Enables the dev-only wish gallery route in E2E builds. |
| `PI_ATLAS_PAGES_DEPLOY` | CI | Pages deploy guard. |
| `PI_ATLAS_DATASET_URL` | CI | Same-origin dataset chunk URL. |

No secrets are used by the frontend; never put a token in a `VITE_*` variable —
Vite embeds those values in the public JavaScript bundle.

## Project layout

```
public/data/pi-1b/          same-origin 1B dataset chunks + manifest
public/pi-2m.txt            2M-digit parity fixture
src/
  data/                     WASM backend client, digit windows, manifest store
  engine/                   pure engines kept as parity references + formatters
  generated/pi-wasm/        committed WASM bindings (no Rust in CI)
  pages/                    Home, Explore (5 modes), OddsLab, About
  wishcard/                 Wish Card data contract, renderer, QR, share, UI
  wishcard/dev/             dev-only gallery with local QR decoding
  constants.ts              central facts, branding, SITE_URL
scripts/lint.mjs            dependency-free lint used by npm run lint
tests/unit/                 Vitest unit + integration
tests/e2e/                  Playwright against the production build
tests/e2e-wish/             Playwright against the dev server + gallery
```

## Licence

MIT — see `LICENSE`.
