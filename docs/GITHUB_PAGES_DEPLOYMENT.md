# GitHub Pages deployment (Stage 8)

The production site is a **static artifact only**. No server, no Render/Oracle/
Hugging Face, no paid service, no billing account. `https://samdanisayam.github.io/pi-atlas/`
must remain recoverable throughout the migration.

## 1. Deploy guard

`.github/workflows/deploy.yml` always runs `verify` on a push to `main`, but the
`deploy` job is gated:

```yaml
if: ${{ vars.PI_ATLAS_PAGES_DEPLOY == 'true' }}
```

Until repository variable `PI_ATLAS_PAGES_DEPLOY` is set to `true`, a push
**cannot** overwrite the live site. Set it only after Stage 9/10/11 acceptance
is signed off. To roll back, set it back to `false` and redeploy the known-good
commit, or revert `main` — the previous artifact stays recoverable via Pages
deployments history.

## 2. What CI does

1. `npm ci`
2. `npm run typecheck`
3. `npm test` — 96 unit + integration tests
4. `npm run verify:pi` — SHA-256 of the committed 2M fixture
5. `npm run build` with `VITE_BASE_PATH=./` and `VITE_PI_DATASET_URL` from
   repository variable `PI_ATLAS_DATASET_URL` (default `data/pi-2m/`)
6. `bash scripts/verify_pages_artifact.sh dist "dist/$PI_ATLAS_DATASET_URL"`
7. `npx playwright install --with-deps chromium` + `npm run test:e2e`
8. upload `dist` as the Pages artifact
9. deploy, only if the guard is enabled

**There is no Rust step.** The WASM binary and `wasm-bindgen` JS glue are
committed at `src/generated/pi-wasm/`; Vite hashes the binary into
`dist/assets/pi_wasm_bg-<hash>.wasm`. A developer rebuilding `pi-core` locally
runs `npm run build:wasm` and commits the regenerated directory.

## 3. Artifact contract

`scripts/verify_pages_artifact.sh` fails the build if any of these are missing:

- `dist/index.html`
- `dist/assets/searchWorker-*.js`
- `dist/assets/pi_wasm_bg-*.wasm`
- `dist/<dataset>/web-manifest.json` + `core-manifest.json`
- every chunk file named by the web manifest, with matching byte length and
  SHA-256, summing to `packedBytes == totalDigits/2`
- no `localhost`/`127.0.0.1` in JS/HTML/CSS
- no `url(/`, `href="/`, `src="/` in HTML/CSS (would break a subpath deploy)

The chunk verification is deliberately independent of the app code: it reads
the manifest and hashes the bytes with Node's `crypto`, so a corrupt or
truncated upload is caught at CI time, not in a user's browser.

## 4. Dataset selection

`VITE_PI_DATASET_URL` is a **root path**, not a fidelity switch. It is baked into
the JS at build time by Vite and resolved against `document.baseURI` at runtime,
so both `http://localhost:4174/` and
`https://samdanisayam.github.io/pi-atlas/` work without code changes.

| Root | Digits | Chunks | Size | Status |
| --- | --- | --- | --- | --- |
| `data/pi-2m/` | 2,000,000 | 2 | 1 MB | committed, local dev + CI default |
| `data/pi-1b/` | 1,000,000,000 | 100 | 500 MB | Stage 9, assembled from the 1B source tree |

The 2M chunks are tracked in Git despite the repository-wide `*.bin` ignore:
`.gitignore` has an explicit `!public/data/pi-2m/chunks/*.bin` exception. Do not
remove it — a clean CI checkout must contain both chunk files or the artifact
validator fails with `cannot read chunk 0`.

The 1B chunks are ~477 MiB and are **not** generated or committed by CI. They
are assembled once from the verified source dataset and published as static
Pages files (see `docs/SEARCH_CORRECTNESS_REPORT.md`). If repository policy
forbids large binaries, there is no free GitHub-hosted delivery path — Release
assets fail CORS from the Pages origin and Git LFS serves pointer files.

## 5. Local reproduction

```bash
npm ci
npm run typecheck
npm test
npm run verify:pi
VITE_BASE_PATH=./ npm run build
bash scripts/verify_pages_artifact.sh dist dist/data/pi-2m/
npm run test:e2e
```

`playwright.config.ts` starts only `vite preview`; there is no second service
process. E2E assertions assume the 2M dataset (e.g. `12` → position `148`), so
run them with the default dataset root.

## 6. Known constraints

- Cold 1B search downloads ~477 MiB once; the browser cache and IndexedDB are
  best-effort and may be evicted (especially Safari/iOS/private mode).
- GitHub Pages cannot set COOP/COEP headers, so `SharedArrayBuffer` and WASM
  threads are unavailable. The app uses one Worker and one heavy search/tab.
- Pages has a 1 GB recommended artifact limit; the 500 MB chunk tree plus the
  app fits, but leaves limited headroom.
