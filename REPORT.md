# π Atlas — Final Implementation Report

**Date:** 2026-11-17 · **Status:** complete · **All quality gates green.**

## Scope delivered

A fully static, zero-backend interactive atlas of the first 2,000,000 decimal
digits of π, per the PRD: five explorers (Digits, Dates, Letters, Colours,
Shapes), a Probability Laboratory, a four-act guided tour, shareable deep
links, live statistics, PNG export, search history, theme + accessibility
settings — every number on screen computed live from the verified dataset.

## Verification results (final run)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -b` | clean, 0 errors |
| Unit + integration | `npx vitest run` | **80/80 passed** (8 files) |
| End-to-end | `npx playwright test` | **16/16 passed** (1.1 min, chromium) |
| Production build | `npx vite build` | success in ~2.6 s |
| Dataset verification | `npm run verify:pi` | all checks passed |

Dataset verification details:

- SHA-256 matches published checksum:
  `efcbafbaf15047f32f70d8b1b008bac527e9f76d4d4b995d7f36dfd6dd8dc7ed`
- Independent recomputation (mpmath, dps = 2,000,499) matches the file
- Checkpoints: `12` first at decimal position **148**, `999999` at **762**
  (1-based, overlapping matches, no leading `3`)

## Final test-phase fixes

1. **Guided-tour E2E (test 14).** The test waited for a *Skip tour* button;
   the tour intentionally renders *Skip tour* as a **link** (`<Link to="/">`,
   correct semantics for navigation). Test updated to `getByRole("link", …)`.
2. **Skip link broke HashRouter (real app bug, caught by the keyboard E2E).**
   Activating `<a href="#main">` rewrote the hash from `#/explore/digits` to
   `#main`; HashRouter parsed that as route `/main` and fell through to Home,
   ejecting the user from the page. Fix in `src/App.tsx`: the skip link now
   `preventDefault()`s the hash change and focuses `<main tabIndex={-1}>`
   programmatically (with `scrollIntoView`). Keyboard behaviour preserved,
   router ownership of the hash preserved. Documented as decision D12.
3. **E2E-vs-stale-build trap.** Playwright serves `dist/` via `vite preview`
   (`reuseExistingServer: true`); source changes require `npm run build`
   before `npm run test:e2e`. Documented as decision D14.

## Deliverables

| Item | Location |
|---|---|
| Source | `src/` (pages, `engine/`, `workers/`, components, tour, stores) |
| Verified dataset | `public/pi-2m.txt` + `public/pi-2m.sha256` |
| Dataset tooling | `scripts/generate_pi.py`, `scripts/verify_pi.py` |
| Social card | `public/og.png` (1200×630) via `npm run generate:og` |
| Docs | `README.md`, `DECISIONS.md` (16 decisions), this report |
| Licence | `LICENSE` (MIT) |

## Performance

- Cold dataset fetch → validate → SHA-256: ~175 ms warm; first load in a fresh
  browser context can reach ~30 s only under heavy machine IO contention
  (measured; environmental, not an app defect — the 2 MB text file streams
  from the same origin).
- Pattern scans (2,000,000 cells) run in a Web Worker with progress and
  cancel; UI stays interactive throughout.
- Digit field is row-virtualised (`@tanstack/react-virtual`); minimap samples.
- Bundle (gzip): core **61.6 kB**, Explore page 24.6 kB, Home 42.5 kB
  (lazy routes); CSS 5.2 kB gzip; fonts self-hosted woff2.
- 2.9 MB total `dist/`, of which 2.0 MB is the dataset itself.

## Accessibility

Skip link (router-safe), ARIA live regions for search results, keyboard
pattern painting, visible focus, reduced-motion support, 4.5:1 contrast in
both themes, semantic landmarks, mobile bottom navigation at 360 px.
Enforced by dedicated E2E tests (keyboard navigation, mobile layout).

## Deployment

Static `dist/` — any host works, no redirects or rewrites needed (hash
routing). Build: `npm run build`; publish `dist/`. Works on Netlify,
Cloudflare Pages, Vercel, GitHub Pages, or plain file hosting. Full
instructions in `README.md`.

## Known limitations

- Normality of π is unproven; odds are labelled as an idealised model, not a
  claim (D10).
- Letter search caps words at 12 letters; pattern scans at 12 painted cells —
  both beyond anything the 2M-digit dataset could plausibly contain.
- Social crawlers may need an absolute `og:image` URL depending on host
  (noted in README).

---

## Addendum — Mobile-first, fully responsive engineering (2026-11-17)

The phone is now the default layout; desktop is unchanged at `md`+.

**Shell.** Below 768px the header compacts to logo + contextual page title +
settings (44px targets), and a fixed bottom navigation provides Home / Digits /
Letters; Patterns and More open responsive bottom sheets (max 85vh, safe-area
padding, labelled close button, Escape, focus management). Desktop keeps the
header nav and the 3-column explorer grid. New `/history` route; session
history reused as a shared panel (`HistoryPanel`).

**No-overflow rule (measured, 28 viewport×orientation pairs).** 280→1920px in
portrait and landscape all pass `scrollWidth <= clientWidth`
(`tests/e2e/responsive.spec.ts`). Fixes found by the suite: Home grid min-width
trap (48-char unbroken digit string), off-screen `sr-only` spans inside
`nowrap` previews, header intrinsic width at 768px, stage header rows at 320px
(now wrap), `TourStage` act-jump targets (6px→36px), occurrence-nav targets
(36px→44px). Invalid `calc()` arbitrary-value classes (missing spaces) fixed in
`App.tsx`, `Toast.tsx`, `Explore.tsx`.

**Performance / memory.** PixelField backing store capped at 2× DPR; occurrence
list windowed (PAGE=50 + "Show more") with auto-expand to the selected match —
no more full-result DOM rendering.

**A11y.** Bottom nav labelled, ≥56px targets, safe-area-aware fixed bars;
dialogs get focus-in/restore, Escape, scrollable body; both stage headers wrap
without overflow; Explore renders a (screen-reader-only) `h1`.

**Verified.** Unit 80/80 ✅; E2E 48/48 ✅ (16 existing + 32 responsive) at all
14 listed widths × 2 orientations against the 2M fixture; no console errors at
320px; screenshots in `docs/screenshots/`.

**NOT tested (no tooling/device in this environment):** real Android/iOS
devices, Lighthouse scores, foldable posture changes, virtual-keyboard
occlusion of inputs, and any OS-level safe-area inset behaviour beyond headless
Chromium with inset 0. 1B-digit performance characteristics are measured at the
service layer (D20) but not end-to-end on a mid-range device.
