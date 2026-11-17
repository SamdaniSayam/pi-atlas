// Diagnostic: runs one Rust/WASM search_pattern on the 2M fixture with RSS/timing, to isolate engine cost from parity-test cost.
const fs = require("fs"), path = require("path");
const PKG = path.join(process.cwd(), "service/target/wasm-pkg-node");
const DATA = "/home/megalith/pi-atlas-build/data-2m";
const spec = JSON.parse(process.argv[2]);
const cols = BigInt(process.argv[3]);
const cap = Number(process.argv[4] || 64);
const { PiEngine } = require(path.join(PKG, "pi_wasm.js"));
const mj = fs.readFileSync(path.join(DATA, "manifest.json"), "utf8");
const m = JSON.parse(mj);
const e = new PiEngine(mj);
m.chunks.forEach((_, i) =>
  e.set_chunk(i, new Uint8Array(fs.readFileSync(path.join(DATA, "chunks", `chunk_${String(i).padStart(5, "0")}.bin`)))));
const rss = () => ((process.memoryUsage().rss / 1e6) | 0) + "MB";
console.error("loaded rss=" + rss());
const t = Date.now();
const out = e.search_pattern(JSON.stringify(spec), cols, cap);
console.error(`done rss=${rss()} ${Date.now() - t}ms json=${out.length} bytes`);
console.log(out.slice(0, 200));
