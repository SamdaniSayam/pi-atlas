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
3. `npm test` — 99 unit + integration tests
4. `npm run verify:pi` — SHA-256 of the committed 2M fixture
5. **Verification build**: `npm run build` with `VITE_BASE_PATH=./` and
   `VITE_PI_DATASET_URL=data/pi-2m/` → `dist`
6. `bash scripts/verify_pages_artifact.sh dist dist/data/pi-2m/`
7. `npx playwright install --with-deps chromium` + `npm run test:e2e` (2M
   assertions: `12` → position `148`, `1 / 19,800`)
8. **Deploy build**: `npx vite build --outDir dist-deploy` with
   `VITE_PI_DATASET_URL` from repository variable `PI_ATLAS_DATASET_URL`
   (default `data/pi-2m/`; set to `data/pi-1b/` for full production)
9. `bash scripts/verify_pages_artifact.sh dist-deploy "dist-deploy/$PI_ATLAS_DATASET_URL"`
10. upload `dist-deploy` as the Pages artifact
11. deploy, only if the guard `PI_ATLAS_PAGES_DEPLOY == 'true'` is enabled

The two builds exist so the dataset-specific E2E assertions always run against
2M, while the uploaded site can carry the full 1B tree. Typecheck already ran in
step 2, so step 8 repeats only the Vite build.

**There is no Rust step.** The WASM binary and `wasm-bindgen` JS glue are
committed at `src/generated/pi-wasm/`; Vite hashes the binary into
`dist/assets/pi_wasm_bg-<hash>.wasm`. A developer rebuilding `pi-core` locally
runs `npm run build:wasm` and commits the regenerated directory.

## 3. Artifact contract

`scripts/verify_pages_artifact.sh` fails the build if any of these are missing:

- `dist/index.html`
- `dist/assets/searchWorker-*.js`
- `dist/assets/pi_wasm_bg-*.wasm`
- `<bundle>/<dataset>/web-manifest.json` + `core-manifest.json`
- every chunk file named by the web manifest, with matching byte length and
  SHA-256, summing to `packedBytes == totalDigits/2`
- no real dev endpoints (`localhost:port` or `localhost/api`) in JS/HTML/CSS;
  React Router 7's internal `new URL("http://localhost")` base is allowed
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
| `data/pi-2m/` | 2,000,000 | 2 | 1 MB | committed, local dev + E2E + CI default |
| `data/pi-1b/` | 1,000,000,000 | 100 | 478 MiB | committed, full production deploy |

Both dataset trees are tracked in Git despite the repository-wide `*.bin`
ignore. `.gitignore` has explicit `!public/data/pi-2m/chunks/*.bin` and
`!public/data/pi-1b/chunks/*.bin` exceptions — do not remove them, or a clean
CI checkout loses the chunks and the artifact validator fails with
`cannot read chunk 0`. Each 1B chunk is 5 MB, well under GitHub's 100 MB/file
limit; the repo grows to ~480 MB, under the 1 GB Pages source recommendation.

The 1B tree is **not regenerated in CI** (Generating 1B π digits needs hours and
a huge precision run). It is assembled once from the verified source dataset by
`scripts/make_web_dataset.py` and committed as static Pages files, then checked
byte-for-byte by `scripts/verify_1b_streaming.py` and the artifact validator
(see `docs/SEARCH_CORRECTNESS_REPORT.md`). This is the only free, no-card,
same-origin delivery path: Release assets fail CORS from the Pages origin and
Git LFS serves pointer files.

### Going live (free, no credit card)

```bash
gh variable set PI_ATLAS_PAGES_DEPLOY --body true
gh variable set PI_ATLAS_DATASET_URL --body data/pi-1b/   # or data/pi-2m/
git commit --allow-empty -m "Deploy verified Pages bundle" && git push origin main
```

Set the variables **before** the push so that CI run deploys. To roll back to
the small dataset, set `PI_ATLAS_DATASET_URL=data/pi-2m/` and push again. To
turn deployment off entirely, delete the guard variable.

Costs on the free tier: $0 hosting, $0 Actions minutes for a public repo, soft
100 GB/month bandwidth (~200 cold full-1B searches) with throttling rather than
billing. The Pages artifact has `retention-days: 1`. A cold 1B visit downloads
~478 MiB once, then relies on best-effort IndexedDB/browser caching.

## 5. Local reproduction

```bash
npm ci
npm run typecheck
npm test
npm run verify:pi
VITE_BASE_PATH=./ VITE_PI_DATASET_URL=data/pi-2m/ npm run build
bash scripts/verify_pages_artifact.sh dist dist/data/pi-2m/
npm run test:e2e
# Full 1B deploy bundle (typecheck already covered above):
VITE_BASE_PATH=./ VITE_PI_DATASET_URL=data/pi-1b/ npx vite build --outDir dist-deploy
bash scripts/verify_pages_artifact.sh dist-deploy dist-deploy/data/pi-1b/
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
