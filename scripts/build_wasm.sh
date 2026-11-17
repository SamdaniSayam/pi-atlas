#!/usr/bin/env bash
# Stage 3: reproducibly compile pi-core to WebAssembly and generate JS bindings.
#
# This script is the single source of truth for the WASM build. It:
#   1. builds the `pi-wasm` crate for wasm32-unknown-unknown (release),
#   2. generates browser ES-module bindings (--target web), and
#   3. generates CommonJS bindings (--target nodejs) for the smoke test.
#
# Generated artifacts land under service/target/ (gitignored) for tests, and the
# browser bindings are copied into src/generated/pi-wasm/ so Vite bundles them
# (the .wasm binary becomes a hashed asset via `new URL(..., import.meta.url)`).
# src/generated/ IS committed so GitHub Pages needs no Rust toolchain.
#
# Toolchain prerequisites (one-time):
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli --version 0.2.127 --locked
#
# The CLI version MUST exactly match the wasm-bindgen crate version pinned in
# service/crates/wasm/Cargo.toml, or wasm-bindgen refuses to generate bindings.
set -euo pipefail

WASM_BINDGEN_VERSION="0.2.127"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/service"

echo "==> building pi-wasm for wasm32-unknown-unknown (release)"
cargo build --release --target wasm32-unknown-unknown -p pi-wasm
WASM="target/wasm32-unknown-unknown/release/pi_wasm.wasm"

# Locate the CLI: respect PATH, then the standard cargo bin directory.
if command -v wasm-bindgen >/dev/null 2>&1; then
  CLI="$(command -v wasm-bindgen)"
elif [ -x "$HOME/.cargo/bin/wasm-bindgen" ]; then
  CLI="$HOME/.cargo/bin/wasm-bindgen"
else
  echo "ERROR: wasm-bindgen CLI not found. Install with:" >&2
  echo "  cargo install wasm-bindgen-cli --version $WASM_BINDGEN_VERSION --locked" >&2
  exit 1
fi

CLI_VERSION="$($CLI --version | awk '{print $2}')"
if [ "$CLI_VERSION" != "$WASM_BINDGEN_VERSION" ]; then
  echo "ERROR: wasm-bindgen CLI is $CLI_VERSION but crate is pinned to $WASM_BINDGEN_VERSION" >&2
  echo "  install the matching CLI: cargo install wasm-bindgen-cli --version $WASM_BINDGEN_VERSION --locked" >&2
  exit 1
fi
echo "==> wasm-bindgen CLI $CLI_VERSION"

echo "==> generating browser bindings (--target web)"
$CLI --target web --out-dir target/wasm-pkg-web "$WASM"
printf '{"type":"module"}\n' > target/wasm-pkg-web/package.json

echo "==> copying browser bindings into src/generated/pi-wasm/ (committed for Pages)"
mkdir -p "$ROOT/src/generated/pi-wasm"
cp target/wasm-pkg-web/pi_wasm.js target/wasm-pkg-web/pi_wasm.d.ts \
   target/wasm-pkg-web/pi_wasm_bg.wasm target/wasm-pkg-web/pi_wasm_bg.wasm.d.ts \
   "$ROOT/src/generated/pi-wasm/"
printf '{"type":"module"}\n' > "$ROOT/src/generated/pi-wasm/package.json"

echo "==> generating Node bindings (--target nodejs, for smoke tests)"
$CLI --target nodejs --out-dir target/wasm-pkg-node "$WASM"
printf '{"type":"commonjs"}\n' > target/wasm-pkg-node/package.json

echo "==> WASM build complete"
echo "    browser (source): src/generated/pi-wasm/"
echo "    node:             service/target/wasm-pkg-node/"
