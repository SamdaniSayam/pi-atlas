# Audit remediation record (2026-11-18)

This records the fixes applied after the 2026-11-18 deep audit, following the
same staged triage → implement → verify → report path as the Pages-only
migration. No unverified change was deployed.

## A1 — correctness and memory (commit `ea823ee`)

- `service/crates/core/src/dataset.rs`: whole-file SHA-256 now streams each
  chunk into a `Sha256` hasher. The old code built a second ~500 MB
  concatenation, pushing 1B load peak RSS over the systemd 1 GB cap.
- `src/data/browser/dto.ts`: date results derive `incomplete` from actual
  format rows instead of hardcoding `false`.
- `src/data/browser/localBackend.ts`: results reporting `incomplete` are never
  cached, so a cancelled/deadline-stopped scan cannot poison later queries.
- `src/data/piApi.ts`: runtime guard for a missing/invalid `job_id` in the
  test-only HTTP branch (no more silent `undefined` job).
- `src/pages/Explore.tsx`: `activePatternJobId` moved from module scope to a
  per-component `useRef`.

## A2 — WASM boundary and polling (commit `ea823ee`)

- `service/crates/wasm/src/lib.rs`: direct validation on every exported
  `PiEngine` method — digits (ASCII, ≤4096, positive cap), words (1–12 A–Z),
  calendar dates, pattern geometry/values/caps. Invalid input returns an error
  instead of panicking across the WASM ABI.
- `src/data/piApi.ts`: adaptive polling backoff, 50 ms → 400 ms.
- Generated browser bindings rebuilt and committed.

## A3 — dependency remediation (commits `3831549`, `79f0299`, `91997e8`)

| Stage | Change | Audit effect |
| --- | --- | --- |
| A3a | Vitest 2 → 5; `vite.config.ts` imports `defineConfig` from `vitest/config`, removing the `as never` cast | 18 → 14; **both critical CVEs eliminated** |
| A3b | Tailwind 3 → 4 (`@import "tailwindcss"`, `@tailwindcss/postcss`, legacy config removed) | 14 → 7; all Tailwind-related highs eliminated |
| A3c | React Router 6 → 7 (all APIs used are v6-compatible; no React upgrade needed) | 7 → 5; **both moderate production CVEs eliminated** |

### Remaining 5 findings — no fix available upstream

All five (`picomatch`, `tinyglobby`, `fdir`, and their `vite`/`vitest` parents)
trace to GHSA-fc5q-39xc-vjpf (picomatch ReDoS). `picomatch@4.0.7` is the latest
published version and is still in the affected range; npm's suggestion to
downgrade Vitest to 3.1.4 does not resolve the transitive advisory. These are
dev-tooling-only and do not ship in the Pages artifact. Re-audit when a patched
`picomatch` is released.

## Parity memory safety (commit `ea823ee`)

The pattern phase once grew to ~5 GB and was SIGKILLed, taking the parent agent
app with it. Cause: the JS reference kept 200,000 matches while the engine was
capped at 64; the failed `assert.deepEqual` then built a huge structural diff.

- One shared `PATTERN_MATCH_CAP = 64` used by both engine and reference.
- `eq()` uses `isDeepStrictEqual` plus a bounded `brief()` formatter — a
  200,000-element mismatch renders in 336 chars.
- 250 ms RSS watchdog aborts at 512 MB before the kernel OOM killer can act.
- `npm run test:parity` (`scripts/parity_safe.sh`) runs each phase under
  `systemd-run --user --scope` with `MemoryMax=1500M` and no swap.

Every phase peaks near 67 MB; full run: **100/100 assertions passed**.

## CI-only fixes

- `mpmath==1.4.1` installed before `verify:pi` (the previous workflow never
  needed it).
- `.gitignore` now has `!public/data/pi-2m/chunks/*.bin`; the global `*.bin`
  rule had silently excluded the 1 MB 2M dataset from the clean checkout.
- The artifact validator's localhost grep now matches only real dev endpoints
  (`host:port` or `host/api`), not React Router 7's internal
  `new URL("http://localhost")` base.

## Verification after A3

`typecheck` 0, unit/integration 99/99, `build` 0, artifact validator green,
E2E 48/48, WASM smoke 12/12, parity 100/100, `npm audit` 5 (all no-fix-upstream,
dev-only). Deploy remains gated by `PI_ATLAS_PAGES_DEPLOY == 'true'`.
