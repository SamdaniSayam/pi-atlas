/**
 * Stage 3 WASM smoke test.
 *
 * Instantiates the generated WebAssembly module in Node and drives every
 * PiEngine method against the REAL committed 2M-digit π fixture, asserting
 * known-correct answers. This proves the WASM build preserves pi-core's
 * search semantics before any browser integration (Stage 4).
 *
 * Prerequisites:
 *   1. bash scripts/build_wasm.sh         (builds WASM + Node bindings)
 *   2. datasets at PI_WASM_DATA_DIR (default: /home/megalith/pi-atlas-build/data-2m)
 *
 * Run:  node scripts/wasm_smoke.cjs
 * This is an opt-in test requiring the Rust WASM toolchain; it is intentionally
 * NOT part of `npm test` (which must stay runnable without Rust on CI).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const PKG = path.join(ROOT, "service/target/wasm-pkg-node");
const DATA_DIR = process.env.PI_WASM_DATA_DIR || "/home/megalith/pi-atlas-build/data-2m";

let checks = 0;
function ok(label, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${label}`);
}

function main() {
  const { PiEngine } = require(path.join(PKG, "pi_wasm.js"));
  const manifestJson = fs.readFileSync(path.join(DATA_DIR, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestJson);
  const packed = Buffer.concat(
    manifest.chunks.map((_, i) =>
      fs.readFileSync(path.join(DATA_DIR, "chunks", `chunk_${String(i).padStart(5, "0")}.bin`)))
  );

  const engine = new PiEngine(manifestJson, new Uint8Array(packed));

  ok("engine loads real 2M dataset with correct geometry", () => {
    assert.equal(engine.total_digits, 2_000_000n);
    assert.equal(engine.chunk_count, 2);
  });

  ok("get_window returns exact leading π digits", () => {
    assert.equal(engine.get_window(1n, 10n), "1415926535");
    assert.equal(engine.get_window(148n, 150n), "128"); // "12" checkpoint begins at 148
  });

  ok("find_first honours the 1-based '12' -> 148 checkpoint", () => {
    assert.equal(engine.find_first("12"), 148n);
    assert.equal(engine.find_first("99999999999999999999"), 0n);
  });

  ok("search_exact returns overlapping positions, uncapped total and flags", () => {
    const r = JSON.parse(engine.search_exact("12", 20));
    assert.equal(r.positions[0], 148);
    assert.equal(r.total, 19_800);
    assert.equal(r.positions.length, 20);
    assert.equal(r.truncated, true);
    assert.equal(r.incomplete, false);
  });

  ok("longest_existing_prefix returns null or a valid shorter prefix", () => {
    const absent = "987654321098765432109876543210";
    const r = JSON.parse(engine.longest_existing_prefix(absent));
    if (r !== null) {
      assert.ok(Array.isArray(r) && r.length === 2);
      assert.ok(r[0] >= 1 && r[0] < absent.length);
      assert.ok(r[1] >= 1);
    }
  });

  ok("search_letters scans both pair frames with the (10a+b) mod 26 encoding", () => {
    const r = JSON.parse(engine.search_letters("PI", 20));
    assert.equal(r.word, "PI");
    assert.equal(r.frames.length, 2);
    for (const f of r.frames) {
      assert.ok(["A", "B"].includes(f.frame));
      assert.ok(f.total > 0);
      assert.ok(f.positions.length > 0 && f.positions[0] >= 1);
      assert.equal(f.capped, true);
    }
    assert.ok(r.total > 0);
    assert.equal(r.incomplete, false);
  });

  ok("search_pattern matches the colour grid at the known first cell", () => {
    const spec = JSON.stringify({ rows: 1, cols: 2, cells: [1, 4], colour_mode: true });
    const r = JSON.parse(engine.search_pattern(spec, 10n, 20));
    assert.equal(r.matches[0].position, 1); // digits 1,4 at positions 1,2
    assert.ok(r.total > 0 && r.anchors > 0);
    assert.equal(r.incomplete, false);
  });

  ok("search_dates encodes all six DD/MM/YYYY and YY variants", () => {
    const rows = JSON.parse(engine.search_dates(2024, 1, 15));
    assert.equal(rows.length, 6);
    const expected = {
      DDMMYYYY: "15012024", MMDDYYYY: "01152024", YYYYMMDD: "20240115",
      DDMMYY: "150124", MMDDYY: "011524", YYMMDD: "240115",
    };
    for (const row of rows) {
      assert.equal(row.sequence, expected[row.id]);
      assert.equal(row.label, row.id);
      assert.ok(row.result && typeof row.result.total === "number");
      assert.equal(row.result.incomplete, false);
    }
  });

  ok("compute_stats counts every digit and yields a finite chi-square", () => {
    const s = JSON.parse(engine.compute_stats());
    assert.equal(s.total_digits, 2_000_000);
    assert.equal(s.counts.length, 10);
    assert.equal(s.counts.reduce((a, b) => a + b, 0), 2_000_000);
    assert.ok(Number.isFinite(s.chi_square) && s.chi_square > 0);
  });

  ok("constructor rejects checksum-corrupted packed data", () => {
    const bad = new Uint8Array(packed);
    bad[0] ^= 0x01;
    assert.throws(() => new PiEngine(manifestJson, bad));
  });

  console.log(`\nAll ${checks} WASM smoke checks passed against the real 2M π fixture.`);
  engine.free();
}

try {
  main();
} catch (err) {
  console.error("WASM smoke test FAILED:", err && err.message ? err.message : err);
  process.exit(1);
}
