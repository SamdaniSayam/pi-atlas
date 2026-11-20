#!/usr/bin/env bash
# Stage 8: verify a Vite production build is a complete, self-contained GitHub
# Pages artifact for the browser-only search engine.
#
#   bash scripts/verify_pages_artifact.sh [dist-dir] [dataset-root-in-dist]
#
# Defaults: dist, dist/data/pi-2m. Exits non-zero on the first failure.
# This runs in CI before upload-pages-artifact and locally before a manual push.
set -euo pipefail

DIST="${1:-dist}"
DATASET="${2:-$DIST/data/pi-2m}"

fail() { echo "ERROR: $*" >&2; exit 1; }

[[ -f "$DIST/index.html" ]] || fail "missing $DIST/index.html"

# The worker, WASM binary and committed glue must all be emitted by Vite.
shopt -s nullglob
workers=("$DIST"/assets/searchWorker-*.js)
wasms=("$DIST"/assets/pi_wasm_bg-*.wasm)
(( ${#workers[@]} > 0 )) || fail "no searchWorker-*.js asset in $DIST/assets"
(( ${#wasms[@]} > 0 ))   || fail "no pi_wasm_bg-*.wasm asset in $DIST/assets"

# Static dataset: both manifests + every chunk named by the web manifest.
[[ -f "$DATASET/web-manifest.json" ]]  || fail "missing $DATASET/web-manifest.json"
[[ -f "$DATASET/core-manifest.json" ]] || fail "missing $DATASET/core-manifest.json"

node - "$DATASET" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const root = process.argv[2];
const web = JSON.parse(fs.readFileSync(path.join(root, "web-manifest.json"), "utf8"));
const core = JSON.parse(fs.readFileSync(path.join(root, "core-manifest.json"), "utf8"));
const bad = (m) => { console.error("ERROR: " + m); process.exit(1); };

if (web.format !== "pi-atlas-packed-v1") bad(`web format ${web.format}`);
if (core.format !== web.format) bad("web/core manifest format mismatch");
if (web.totalDigits !== core.total_digits) bad("web/core totalDigits mismatch");
if (web.chunkDigits !== core.chunk_digits) bad("web/core chunkDigits mismatch");
if (web.firstDigits !== core.first_digits) bad("web/core firstDigits mismatch");
if (web.sha256Packed !== core.sha256_packed) bad("web/core sha256Packed mismatch");
if (web.chunkCount !== web.chunks.length) bad("chunkCount != chunks.length");
if (Array.isArray(core.chunks) && core.chunks.length !== web.chunks.length) bad("web/core chunk count mismatch");
if (!Array.isArray(web.chunks) || web.chunks.length === 0) bad("no chunks");

// Verify every chunk's SHA-256 and packed byte length against the manifest.
let totalBytes = 0;
web.chunks.forEach((c, i) => {
  if (c.index !== i) bad(`chunk ${i} has wrong index`);
  const file = path.join(root, web.baseUrl || "", c.file);
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (e) { bad(`cannot read chunk ${i} (${file})`); }
  if (bytes.length !== c.bytes) bad(`chunk ${i} length ${bytes.length} != ${c.bytes}`);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha !== c.sha256) bad(`chunk ${i} sha256 mismatch`);
  // The WASM engine re-verifies every chunk against the core manifest. A
  // divergent web manifest would make the shipped dataset unusable at runtime.
  const coreChunk = Array.isArray(core.chunks) ? core.chunks[i] : undefined;
  if (coreChunk) {
    if (coreChunk.digits !== c.digits) bad(`chunk ${i} digits differ from core manifest`);
    if (coreChunk.bytes !== c.bytes) bad(`chunk ${i} bytes differ from core manifest`);
    if (coreChunk.sha256 !== c.sha256) bad(`chunk ${i} sha256 differs from core manifest`);
  }
  totalBytes += bytes.length;
});
if (totalBytes !== web.packedBytes) bad(`packed bytes ${totalBytes} != ${web.packedBytes}`);
if (totalBytes !== core.total_digits / 2) bad("packed bytes != totalDigits/2");

console.log(`dataset OK: ${web.totalDigits} digits, ${web.chunks.length} chunks, ${totalBytes} packed bytes`);
NODE

# Pages serves from a subpath: no absolute asset URLs or dev-server endpoints.
# React Router 7 legitimately embeds `new URL("http://localhost")` as an
# internal URL-normalization base (no port, no /api path), so match only real
# dev-server references: a host:port pair or a host/api path.
if grep -R -E '(localhost|127\.0\.0\.1):[0-9]+|(localhost|127\.0\.0\.1)/api' "$DIST" --include='*.js' --include='*.html' --include='*.css' >/dev/null 2>&1; then
  fail "production bundle references a localhost/127.0.0.1 dev endpoint"
fi
if grep -R -E 'url\(/|href="/|src="/' "$DIST" --include='*.html' --include='*.css' >/dev/null 2>&1; then
  fail "absolute asset path breaks GitHub Pages subpath"
fi

echo "Pages artifact OK: worker + WASM + verified dataset + relative assets"
