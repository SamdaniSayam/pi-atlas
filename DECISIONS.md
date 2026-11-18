# Decision Log

Architectural and product decisions for π Atlas, newest last within each
section. Each entry: decision, why, and consequences.

## Dataset & correctness

### D1 — Generate π with mpmath, verify independently
The dataset is produced by `scripts/generate_pi.py` (mpmath at 50 digits of
guard precision beyond the 2,000,000 requested) and verified by a *separate*
script, `scripts/verify_pi.py`, which recomputes in blocks, re-computes block 1
at higher precision as a canary, and checks the published SHA-256
(`efcbafbaf15047f32f70d8b1b008bac527e9f76d4d4b995d7f36dfd6dd8dc7ed`).
Consequence: regeneration is byte-identical; trust rests on two code paths, not
one.

### D2 — No leading `3`; positions are 1-based decimal positions
The dataset is only the digits after the decimal point. All UI, URLs, and tests
treat position 1 as the first digit after the point (`1` of `3.14159…`).
Matches overlap: `111` in `11111` occurs three times. Consequence: search
results agree with what a human counting digits by hand would say.

### D3 — Known checkpoints are pinned in tests
`12` first appears at position 148 and `999999` at position 762; these are
asserted in unit tests and used in the guided tour. Consequence: a dataset
regression cannot ship silently.

## Architecture

### D4 — HashRouter; the URL is the source of truth
React Router 6 with `HashRouter`. Every search state serialises into query
params (`#/explore/digits?q=999999`), and deep links auto-run their search on
mount. Consequence: sharing works from any static host with zero server
config; the trade-off (no path-based URLs) is accepted for deployability.

### D5 — Full-dataset pattern scans run in a Web Worker
Colour/shape scans over 2,000,000 cells run in
`src/workers/pattern.worker.ts` with progress reporting and cancellation.
Results flow through a small observable store consumed by `Explore.tsx`.
Consequence: the UI never blocks; cancellation is instant; the engine stays
pure and unit-testable outside React.

### D6 — Letters are digit-pair values matched with KMP in two frames
A–Z maps to 01–26; the stream is read in two alignments (frame A starts at
digit index 0, frame B at index 1) because the pairing offset is unknowable in
advance. Matching is a hand-rolled KMP over pair values, capped at 12 letters.
Letter probabilities (0.04 for A–V, 0.03 for W–Z) feed the odds model.
Consequence: results are honest about both alignments; complexity is
O(n + m) per frame.

### D7 — Zustand for app state; no global context trees
`piStore` (dataset fetch → validate → hash), `useSettings` (localStorage v1:
theme, motion, digit grid preferences), `useHistory` (last 20 searches).
Consequence: stores are testable headlessly and the worker/store boundary
stays plain.

### D8 — @tanstack/react-virtual for the digit field
The 2,000,000-digit view virtualises rows; the minimap samples the dataset
rather than rendering it. Consequence: smooth scrolling at full dataset size
without memory blow-up.

### D9 — Self-hosted fonts
Fraunces, Inter and JetBrains Mono ship as woff2 files in `public/fonts/` with
a small `fonts.css`. Consequence: no third-party requests, no GDPR surface,
works offline; variable-weight files keep the payload small.

## Product honesty

### D10 — Odds are labelled as a model, never a claim
The Probability Lab presents the idealised-random-model probability ("1 in
10^n per anchor") and always labels it as such; the About page and stat panels
repeat that consistency with a uniform model is not proof of normality.
Consequence: the app never overclaims — the maths is real, the interpretation
is careful.

### D11 — Every number on screen is computed from the dataset
No hardcoded results, no mock data, no placeholder strings. The home page
chi-square panel, tour demos and explorer results all run the same engines.
Consequence: a data regression fails tests, not users' trust.

## Accessibility

### D12 — Skip link must not fight the HashRouter
A plain `<a href="#main">` rewrites the hash; inside HashRouter the browser
ends up at route `/main`, which falls through to Home and throws the user off
the page (caught by the E2E keyboard test). Decision: the skip link
`preventDefault()`s the hash change and focuses `<main tabIndex={-1}>`
programmatically, scrolling it into view. Consequence: keyboard users keep the
skip behaviour and the router stays in charge of the hash.

### D13 — Live results are announced, but asserted with `exact: true`
Search outcomes render both a visible badge and an `aria-live` announcement.
E2E selectors target the badge with `{ exact: true }` to avoid strict-mode
ambiguity. Consequence: screen readers get announcements, tests stay precise.

## Tooling

### D14 — E2E runs against the production build on port 4174
`playwright.config.ts` starts `vite preview --port 4174` and reuses an
existing server. Consequence: tests exercise what ships; but a source change
requires `npm run build` before `npm run test:e2e` or you'll test stale output
(this bit us once — see the skip-link fix).

### D15 — Slow first loads in CI-like environments are environmental
Under heavy IO contention the first one or two dataset fetches in a fresh
Chromium context can take ~30s (warm loads are ~175ms). Measured, understood,
and handled with generous expect timeouts — not "fixed" in app code.

### D16 — The social card is generated from real data
`scripts/make_og.mjs` renders an HTML template (real fonts, real first 336
digits from `public/pi-2m.txt`) with Playwright and screenshots it to
`public/og.png` at 1200×630. Consequence: the card is reproducible and can't
drift from the dataset.

## One-billion-digit architecture (2026-11)

### D17 — A Rust service owns the dataset; the browser never holds it
The 1,000,000,000-digit dataset lives as a packed binary file on disk and is
loaded into the search service's memory once (~500 MB). The browser fetches
counts + positions from a JSON API and small digit windows for visualization.
This replaces the single 2,000,000-digit static text file era. Why: the plan
(1B digits) cannot fit a browser memory budget alongside search scans, and
matching the product goal "one canonical dataset shared by all explorers"
requires one implementation of the search semantics, not re-ports that drift.
Consequences: no offline/diskless browsing out of the box; the packed dataset
is distributed out of band (not committed); searches report progress and can
be cancelled; the odds/difficulty maths stays client-side (it is presentation
on top of counts).

### D18 — Streaming scan is the default search engine; FM-index is reference-only
`pi-bench` compared a streaming packed-Nibble scan against an FM-index
(fm-index 0.3.1) at 2M/10M/100M digits (identical counts and sorted positions
at every scale):

| scale | streaming build | streaming query (12) | FM build | FM query (12) | FM bytes/digit (build HWM) |
|---|---|---|---|---|---|
| 2M  | 4.8 ms  | 3.3 ms  | 267 ms | 0.003 ms | 1.18 (86 MB) |
| 10M | 23.9 ms | 17.1 ms | 1.98 s | 0.003 ms | 1.27 (388 MB) |
| 100M| 259 ms  | 189.7 ms| 32.4 s | 0.004 ms | 1.37 (2.88 GB)|

Extrapolated FM construction at 1B is ~29 GB RAM — not viable on this 7 GB
box; also FM gives O(pattern) count latency but is a second scan for locate
and cannot express the colour/shape 2-D constraint engine at all. The
streaming engine reads the packed file directly (~530–640 MB/s effective),
supports chunk progress + cancellation, and needs no persistent index.
Decision: streaming everywhere; FM-index remains in `pi-bench` as a
cross-check reference. Consequence: worst-case interactive exact scan at 1B is
~1.6–1.8 s (measured, not extrapolated), which is why the API is async
(202 + polling) instead of blocking.

### D19 — Packed dataset format: `pi-atlas-packed-v1`
Digits after the point only, packed two digits per byte (big nibble = even
0-based position). Storage directory = `manifest.json` + `chunks/chunk_NNNNN.bin`.
Chunk digit counts are even (whole bytes, no padding). The manifest carries
the format id, total_digits, chunk_digits, first_digits (64), checkpoints
(`12` first at 148), per-chunk SHA-256, and a whole-file SHA-256 over the
concatenated packed chunks. `scripts/pack_dataset.py` produces it and then
re-verifies checksums and unpacks spot positions before reporting success.
Consequence: one canonical artifact servable unchanged at 2M/10M/100M/1B; the
server refuses to start on any checksum mismatch.

### D20 — Async job API with progress, deadlines, and cancellation
Search endpoints (`exact`, `letters`, `dates`, `pattern`) return `202 { job_id }`;
clients poll `/api/v1/jobs/{id}` (status, `{checked,total}` progress, full
result) and can `POST .../cancel`; terminal jobs are evicted after 5 minutes.
Jobs carry a deadline (`PI_ATLAS_TIMEOUT_SECS`, default 300), a concurrency
semaphore (`PI_ATLAS_MAX_CONCURRENT`, default 4) and a queue cap (429 when
more than 16 queued). Results cache for `PI_ATLAS_CACHE_TTL_SECS` (default
600) by canonical query — repeated submissions return `200 { cached: true }`
with no job. Honest errors as `{error:{code,message}}`. The exact-search
`longest_existing_prefix` (TS `longestExistingPrefix`) runs as a second KMP
pass only when the query is absent. Consequences: the UI never re-implements
search; a dead service degrades to an error state instead of hanging tabs;
and progress bars in the UI are real server-side scan progress.

### D21 — Windowed rendering: the browser only ever sees slices
The digit viewer is row-virtualized and pulls digits from `/window` through a
2,048-digit bucket cache (24 buckets, in-flight dedup, batched notifications);
the pixel field is a viewport-sized canvas that draws only visible rows inside a
50,000-row window centred on the focused match. All odds/difficulty maths stays
client-side, on manifest sizes. Consequences: memory is flat at any dataset
size (scrolling to digit 999,999,000 costs one ~4 KB fetch), and no engine code
runs in the page — the local engines are kept only as parity fixtures for unit
tests. Recorded lesson: a context hook placed after an early-return guard
crashed production with React error #310 ("rendered more hooks") because the
hook count changed between renders; hoisting the hook above the guard fixed it.

### D22 — Mobile-first shell: bottom navigation, sheets, and the no-overflow rule
The phone is the default layout. Below `md` (768px) the header collapses to a
compact bar (π logo, contextual page title, settings) and a fixed bottom
navigation carries Home / Digits / Letters / Patterns / More; Patterns and More
open bottom-sheet dialogs (Colours+Shapes, and Probability Lab/History/About/
Settings) instead of burying features. At `md+` the previous desktop header nav
and the 3-column explorer grid are unchanged. All overlays reuse one responsive
`DialogShell`: bottom sheet under 768px (max 85vh, safe-area bottom padding,
scrollable body, labelled close button), centred dialog at `md+`, Escape to
close, focus moved in and restored on close. Layout rules: single column below
`lg`, `min-w-0` on grid/flex items whose content can be long, `overflow-x-auto`
inside the pattern grid instead of page-level scroll, and 44–48px touch
targets (buttons 48px, fields 44px, icon buttons 44px, chips 36px, nav items
56px). Safe-area insets are honoured via `--safe-*` tokens and the bottom nav /
toast / main padding. Verified, not claimed: `tests/e2e/responsive.spec.ts`
asserts `scrollWidth <= clientWidth` at 280/320/360/375/390/414/430/480/600/
768/1024/1280/1440/1920 in portrait AND landscape (28 measurements), plus
bottom-nav clearance below 768px and its absence at md+, sheet open/Escape/
close-button/focus behaviour, key pages at 320px with zero console errors, and
>=44px occurrence-nav buttons. Screenshots: `docs/screenshots/m{320,390}-*.png`
(regenerate with `node scripts/mobile-shots.mjs`). Honest limits: no real
Android/iOS device, no Lighthouse run, no foldable-posture or virtual-keyboard
occlusion testing was available in this environment; those remain untested.

## D23 — Public production deployment: GitHub Pages + user-owned HTTPS API (2026-11-17)

**Context.** Move from the local demo (frontend 4174 → 1B service 7780) to a
real public site without interrupting local development. GitHub Pages cannot
run the Rust service; the 477 MB 1B dataset must stay out of Git.

**Decision.**
- Frontend: GitHub Pages project site at `https://samdanisayam.github.io/pi-atlas/`.
  Vite `base: "./"` (override `VITE_BASE_PATH`), relative favicon/fonts/og:image,
  relative `@font-face` URLs, HashRouter preserved (refresh/direct nav need no
  server rewrites). `src/data/piApi.ts` resolves the API root from
  `window.__PI_ATLAS_API__` → `VITE_PI_ATLAS_API` → same-origin `/api/v1`.
- Backend: unchanged Rust/axum service on a user-owned low-cost VPS (Oracle
  Ampere A1 free / Hetzner CX22 ~€4/mo) behind Caddy TLS on loopback; CORS
  allowlist (`PI_ATLAS_CORS_ORIGINS`), 64 KB body limit, SIGTERM graceful
  shutdown, bounded concurrency. Hostname/origin are deployment inputs, never
  hardcoded private infrastructure.
- CI: `.github/workflows/deploy.yml` does `npm ci` → typecheck → 80 unit tests
  → regenerate the 2M pack from the committed parity fixture → Rust build →
  frontend build → 48 Playwright E2E on ports 4175/7788 → no-localhost/no-
  absolute-asset checks → Pages deploy. All E2E uses ports separate from the
  live demo.
- Verified locally: CORS allow/deny, 413 body-limit, real search, SIGTERM,
  80/80 unit + 48/48 E2E; live Pages: all routes render, 320/375/390/430 px
  have zero overflow, mobile bottom nav works, no page errors, API-down state
  shows a clear error. The only live 404s are API calls until the user deploys
  the backend (expected, not mocked). Font 404s found in live verification were
  fixed by making `@font-face` URLs relative and guarded in CI.

**Limit / stop point.** No cloud CLI or credentials exist in this environment;
the public HTTPS API and `PI_ATLAS_API_URL` variable require the user's cloud
account and DNS (exact commands in DEPLOY.md). Until then the deployed site is
a real static production build with a graceful API-down state — not a local
demo or mock. `og:image` stays relative (some crawlers need an absolute URL;
documented for a custom domain). No force-push or overwriting occurred: repo
`SamdaniSayam/pi-atlas` was created fresh after confirming the name was free.

## Wish card decisions (W0–W5)

### W-D1 — Lint script
The repo had **no** `npm run lint` script and no ESLint config. Added a small
`scripts/lint.mjs` that fails on placeholder markers, `console.log`, and
trailing whitespace in `src/` and `tests/`. Reason: the task requires
`npm run lint` to run after each milestone; this keeps it real and dependency-free.

### W-D2 — No shortcuts dialog existed
The app has no keyboard-shortcuts dialog. One will be added in W3 with the
existing `w`-to-open-wish-card rule so the shortcut has a documented home.

### W-D3 — Long QR payloads
`QRCode.create` reports the symbol version. Versions 10+ are too dense for the
172–260 px card plate, so when the deep link needs version 10 or higher the QR
falls back to the mode's explorer URL without parameters. Reason: a scannable
plate that opens the explorer is more useful than a dense unreadable code; the
full text still goes in the caption.

### W-D4 — Hide my digits and the context strip
`hideQuery` also hides the digits/letters context strip ("Context hidden by
request") in addition to the hero, QR and filename. Reason: the strip would
otherwise reveal the very digits the user asked to keep private.

### W-D5 — iOS Safari download
iOS Safari ignores the `download` attribute on blob links. It is detected via
user agent and the blob URL is opened in a new tab with a "Long-press the image
to save" toast. Reason: no native save API exists there and this matches the
platform's normal save flow.

### W-D6 — Shortcuts dialog
A small lazy-loaded `ShortcutsDialog` was added behind a "?" button in the
header, documenting `w` and `Esc`. Reason: the task requires documenting the
new shortcut, and no shortcuts dialog existed before.

### W-D7 — Glow drawn as flat rings
A full-canvas smooth radial gradient made the square PNG ~985 KB. The glow is
now 24 concentric flat-alpha rings; visually the same soft glow at 5% texture,
but exact repeated colours let PNG compress it below 600 KB. Reason: hard file
size budget for the square card.

### W-D8 — Dataset size comes from the manifest
The first draft reused the old 2M fixture wording ("2,000,000 digits") in card
copy, captions and headers, which would lie about the shipped 1B dataset.
`WishCardInput` now carries `datasetSize` from `useDatasetSize()` (the loaded
manifest, with a 1B pre-load fallback); copy uses "1 billion digits", compact
labels use "1B digits searched". Reason: no hardcoded or fake numbers on a
card; a dataset change updates every card.

## Shared-link banner decisions

### SB-1 — `src=card` is added only to the QR payload
`qrContentFor` appends the marker after the existing hide-query step; captions
and the in-app Copy link still use the untouched `shareUrl`. Reason: only a
scanned card should identify its visitor.

### SB-2 — QR size rule kept its existing fallback
With `src=card`, both the normal (`q=12`) and hidden (`src` only) URLs measure
version 5 (37 modules), well under the version 9 limit. Links long enough to
need version 10+ still fall back to the parameter-free explorer URL, which has
no `src` and therefore no banner. Reason: keep the plate scannable; verified in
unit tests.

### SB-3 — Strict, single-value gate
`parseSrc` accepts only one `src` whose exact value is `card`. Banner copy is
built from app results, never URL text. Reason: `src=evil`, repeated values and
script-like strings must be ignored without injecting anything.

### SB-4 — Fixed-height slot, generic copy first
The Explorer renders a fixed-height slot as soon as `src=card` is present; the
lazy banner shows generic copy there until the result finishes, then swaps the
text in place and announces only the final copy. Reason: no first-load layout
shift and no double announcement; the slot exists only while the banner is up.

### SB-5 — Semantic token aliases
`--bg-raised` and `--line` are aliases of existing `--surface-2` / `--border`
tokens. Reason: the banner uses the requested token names without introducing
any new colours.

### SB-6 — Strip the marker outside Explorer
Home, Odds Lab, About and unknown routes remove any `src` with `replace` and
show no banner. Reason: the banner is Explorer-only; old links without `src`
are already unaffected.

## Build, smoke and layout decisions

### F-1 — Bundle the font CSS instead of linking a `public/` file
The warning came from `index.html` lines 6–7 (`<link rel="preload" href="fonts/fonts.css" as="style">`
and `<link rel="stylesheet" href="fonts/fonts.css">`): with `base: "./"` Vite
leaves relative `public/` URLs untouched and warns they cannot be resolved at
build time. `fonts.css` and its woff2 files now live in `src/assets/fonts/` and
are imported from `main.tsx`, so Vite hashes and emits them into `dist/assets`.
Reason: standard bundler flow removes the warning, keeps fonts self-hosted with
`font-display: swap`, and preserves their appearance. `scripts/make_og.mjs`
reads the same source files.

### SB-7 (smoke) — One sequential Playwright runner, not the test runner
The smoke test is a plain Node script driving Playwright Chromium with one
context/page at a time, rather than a `playwright test` suite. Reason: the
checks must run in a fixed order (search → share link → QR → banner), support
per-check SKIP, and emit a custom Markdown/JSON report with an exact
`RESULT: PASS/FAIL` line — all simpler to control imperatively. It also keeps
live runs polite and bounded to roughly 30 navigations.

### SB-8 (smoke) — Expectations come from the app manifest
`smoke:local` uses the default production build (currently the 2M dataset) and
does not hardcode a dataset size. `manifest-ok` reads the running app's own
manifest (`total_digits`) and only compares it to `SMOKE_EXPECT_DIGITS` when
that variable is set; `digits-12`/`digits-feynman` assert the fixed, dataset-
independent checkpoint positions 148/762. Reason: the production dataset is
~1B digits, so smoke must verify whatever the deployed build actually serves
without baking 2M-only wording into the test.

### SB-9 (smoke) — Preview lifecycle on a free port
`smoke:local` builds only when `dist/` is missing or older than `src/`, picks a
free loopback port, starts `vite preview --strictPort`, and stops the whole
process group in a `finally` block. Reason: no port collisions, no orphaned
server after a failed run, and fast repeated runs against current source.

## Wish Card redesign decisions

### W-D10 — One result PNG path; the old Number Explorer export is gone
Step 0 removed the simple `exportPng*` code from `src/lib/share.ts`; that file
is now clipboard/native-share only. `src/wishcard/` is the sole result-PNG
producer and the OG image stays separate in `scripts/make_og.mjs`. Reason: no
two competing export paths, and every result card is now a rarity-tiered
collectible.

### W-D11 — Exact tier thresholds and honest odds
`TIER_THRESHOLDS = { gold: 0.01, silver: 1 }`: not found → `twilight`; found
with `expected < 0.01` → `gold`, `< 1` → `silver`, else `aurora`. A non-finite
or non-positive `expected` is treated as `1` (→ `aurora`) with no log, so a bad
statistic can never invent a rare card. `oneIn` uses the at-least-one
probability `P = 1 - Math.exp(-expected)` and `Math.round(1 / P)`; the new
`describeMagnitude` helper in `src/engine/format.ts` renders it (e.g.
"1 in 1 million"). Odds appear on gold/silver only.

### W-D12 — Tier names, labels and honest copy
Pill/heading labels are Legendary / Rare / Lucky / Twilight (twilight also uses
"SO CLOSE" or "BEYOND THE HORIZON"). Every card prints the exact fine print
`Odds assume random digits · Statistics, not magic.`; the honesty guard bans
overclaiming words in headlines, sublines, odds and quotes. Only the Hilbert
quote carries `by: "— David Hilbert, 1930"`; no italic font markers anywhere.

### W-D13 — Collectible default, clean is the old Night layout
`collectible` is the new default tiered, emotional, collectible style. The
former Night layout is preserved as the `clean` style; `paper` was removed.
Reason: keep the old look available without two names for it.

### W-D14 — Latin-only dedication
`sanitizeDedication` keeps Latin letters (including accents), digits, spaces,
`. - ’ & ,`, collapses spaces, trims and caps at 24 characters. Anything else
(emoji, other scripts) is dropped with a hint "Latin letters only for now".
The dedication is card/caption text only — never in the QR URL or filename.
Reason: the bundled fonts have no emoji glyphs and canvas text must stay local
and predictable.

### W-D15 — PNG size budgets and grain removal (W-D9)
Budgets: Square ≤1.5 MB, Story ≤2.2 MB, Wide ≤1.0 MB. The first collectible
square was 2.28 MB; reducing seeded grain 5% → 2% only reached 2.07 MB, so
per the required order grain was removed (digit texture retained) and the
gold sheen kept its flat rings (W-D7). Measured after removal: Square 931,746 B,
Story 1,312,910 B, Wide 644,227 B — all under budget. Digit texture was not
reduced because grain removal alone was sufficient.

### W-D16 — Warm gold sheen hues
The gold holographic sheen rainbow stops `[40,120,200,280]` were changed to
`[30,45,60,35]`. A green/blue stop tinted a corner green and failed the
gallery's colour-family check; warm foil-only hues keep the corner gold.

### W-D17 — Gallery/card checks respect style-specific QR plates
`qrPlateFor(format, style)` returns the clean story plate
(`x:410,y:1300,size:260`) and otherwise the collectible plates (square
`836,836,172`, collectible story `72,1330,220`, wide `872,120,220`). The dev
gallery uses the card's own plate for QR decoding and skips collectible box
checks for `clean` cards (which use fixed legacy coordinates). The gallery
still decodes QR and checks colour family for every style. Reason: avoid
false failures from sampling the wrong plate geometry.

### W-D18 — Hash navigation needs a reload in browser checks
HashRouter ignores hash-only `page.goto` when the app is already mounted, so
E2E/smoke `gotoHash` calls `page.goto` followed by `page.reload()` to rebuild
state for each search. Reason: otherwise consecutive tier searches show stale
results. Smoke tier-query lengths are derived from the manifest's
`total_digits` so tiers stay correct on both 2M and 1B builds.

### W-D19 — 1B digit-length tier discrepancy (disclosed)
The brief's stated boundaries (≤8 digits aurora, 9–10 silver, ≥11 gold) assume
a different expected-count curve than the engine actually uses,
`(N-L+1)/10^L`. With N=1B that gives L=9 → ~1 (aurora), L=10 → ~0.1 (silver),
L=12 → ~0.001 (gold). The implementation follows the exact threshold rules in
W-D11 (which are authoritative), not the illustrative digit boundaries. This
is called out here so the tier display is not mistaken for a bug.
