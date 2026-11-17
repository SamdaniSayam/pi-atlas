#!/usr/bin/env bash
# Full verification for the browser-only migration. Memory-conscious:
#   - CARGO_BUILD_JOBS=2 caps parallel rustc processes (~half peak compile RAM)
#   - node --max-old-space-size=512 hard-caps JS heap (fail fast, no runaway)
# Run from anywhere: bash scripts/verify_migration.sh > /tmp/opencode/verify.log 2>&1
set -uo pipefail
cd "$(dirname "$0")/.."

export CARGO_BUILD_JOBS=2
NODE="node --max-old-space-size=512"
LOG=${1:-/dev/stdout}
run() { printf '\n===== %s =====\n' "$1" | tee -a "$LOG"; }
status() { printf '>> %s EXIT=%s\n' "$1" "$2" | tee -a "$LOG"; }

run "npm typecheck"
npm run typecheck >>"$LOG" 2>&1; status typecheck $?

run "npm unit tests"
npm test -- --run >>"$LOG" 2>&1; status npm_test $?

run "npm production build"
npm run build >>"$LOG" 2>&1; status npm_build $?

run "cargo test -p pi-core (native parity)"
cargo test --manifest-path service/Cargo.toml -p pi-core >>"$LOG" 2>&1; status cargo_core $?

run "cargo build --release -p pi-server -p pi-wasm (native)"
cargo build --release --manifest-path service/Cargo.toml -p pi-server -p pi-wasm >>"$LOG" 2>&1; status cargo_native $?

run "wasm build + bindings"
bash scripts/build_wasm.sh >>"$LOG" 2>&1; status wasm_build $?

run "WASM smoke (12 checks, real 2M fixture)"
$NODE scripts/wasm_smoke.cjs >>"$LOG" 2>&1; status smoke $?

run "WASM-vs-reference parity (real 2M fixture)"
$NODE scripts/parity_wasm.cjs >>"$LOG" 2>&1; status parity $?

printf '\n===== DONE =====\n' | tee -a "$LOG"
