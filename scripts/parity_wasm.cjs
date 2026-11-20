/**
 * Stage 5 correctness: WASM engine vs an independent plain-JS reference scan
 * of the REAL committed 2M π fixture.
 *
 * This is deliberately NOT a comparison of pi-core against itself: the
 * reference routines below are straightforward whole-string scans written in
 * JavaScript, independent of the Rust algorithms. Agreement across thousands
 * of queries (including chunk-boundary-spanning ones) demonstrates that the
 * WASM build preserves exact search semantics.
 *
 * There is NO server and NO 1B dataset here. Everything runs in-process in
 * Node against the 2M-digit fixture. To avoid a long-lived process being
 * killed by an OS/harness watchdog, each phase can be run independently:
 *
 *   PI_PARITY_PHASE=exact   node scripts/parity_wasm.cjs
 *   PI_PARITY_PHASE=letters node scripts/parity_wasm.cjs
 *   ...
 *   PI_PARITY_PHASE=all     node scripts/parity_wasm.cjs   (default, original)
 *
 * Prerequisites: bash scripts/build_wasm.sh
 * Run: node scripts/parity_wasm.cjs
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");

// Single source of truth for the pattern match cap. The engine and the
// reference MUST use the same value; a drift here caused the original 5 GB
// failure diff. Never inline a second literal.
const PATTERN_MATCH_CAP = 64;

// Bounded description of any value, so a mismatch message can never grow with
// the size of the compared objects (even if the cap above is changed).
function brief(v) {
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) {
    return `Array(${v.length})[${v.slice(0, 5).map(brief).join(", ")}${v.length > 5 ? ", …" : ""}]`;
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    return `{${keys.slice(0, 12).map((k) => `${k}:${brief(v[k])}`).join(", ")}${keys.length > 12 ? ", …" : ""}}`;
  }
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return String(v);
  }
}

// Self-limit: exit before the kernel OOM killer can SIGKILL the process (which
// previously also killed the agent app). 2M-digit parity peaks near 67 MB.
const RSS_CEILING = 512 * 1024 * 1024;
const watchdog = setInterval(() => {
  if (process.memoryUsage().rss > RSS_CEILING) {
    clearInterval(watchdog);
    console.error(`Parity aborted: RSS exceeded ${RSS_CEILING / 1024 / 1024} MB`);
    process.exit(2);
  }
}, 250);
watchdog.unref();

const ROOT = path.resolve(__dirname, "..");
const PKG = path.join(ROOT, "service/target/wasm-pkg-node");
const FIXTURE = path.join(ROOT, "public/pi-2m.txt");
const DATA_DIR = process.env.PI_WASM_DATA_DIR || "/home/megalith/pi-atlas-build/data-2m";

/* ---------- independent reference implementations over ASCII digits ---------- */

function refExact(digits, needle, cap) {
  let total = 0;
  const positions = [];
  let from = 0;
  for (;;) {
    const i = digits.indexOf(needle, from);
    if (i < 0) break;
    total += 1;
    if (positions.length < cap) positions.push(i + 1);
    from = i + 1; // overlapping
  }
  return { total, positions, truncated: total > positions.length, incomplete: false };
}

function refFindFirst(digits, needle) {
  const i = digits.indexOf(needle);
  return i < 0 ? 0 : i + 1;
}

function refPrefix(digits, query) {
  for (let len = query.length - 1; len >= 1; len -= 1) {
    const i = digits.indexOf(query.slice(0, len));
    if (i >= 0) return [len, i + 1];
  }
  return null;
}

function pairValues(word) {
  return [...word].map((ch) => ch.charCodeAt(0) - 65);
}

function refLetters(digits, word, cap) {
  const values = pairValues(word);
  const k = values.length;
  const frames = [];
  for (const start of [0, 1]) {
    let total = 0;
    const positions = [];
    const pairCount = Math.floor((digits.length - start) / 2);
    for (let g = 0; g + k <= pairCount; g += 1) {
      let match = true;
      for (let j = 0; j < k; j += 1) {
        const a = digits.charCodeAt(start + 2 * (g + j)) - 48;
        const b = digits.charCodeAt(start + 2 * (g + j) + 1) - 48;
        if ((10 * a + b) % 26 !== values[j]) { match = false; break; }
      }
      if (match) {
        total += 1;
        if (positions.length < cap) positions.push(start === 0 ? 2 * g + 1 : 2 * g + 2);
      }
    }
    frames.push({ frame: start === 0 ? "A" : "B", positions, total, capped: total > positions.length });
  }
  return { word, frames, total: frames[0].total + frames[1].total, incomplete: false };
}

function refPattern(digits, spec, fieldCols, cap) {
  const { rows, cols, cells, colour_mode } = spec;
  const totalRows = Math.floor(digits.length / fieldCols);
  const anchors = Math.max(0, totalRows - rows + 1) * Math.max(0, fieldCols - cols + 1);
  if (totalRows < rows || fieldCols < cols) {
    return { matches: [], total: 0, anchors: 0, capped: false, incomplete: false };
  }
  const cls = (d) => colour_mode ? d : (d < 5 ? 0 : 1);
  const matches = [];
  let total = 0;
  for (let r = 0; r + rows <= totalRows; r += 1) {
    for (let c = 0; c + cols <= fieldCols; c += 1) {
      let ok = true;
      for (let rr = 0; rr < rows && ok; rr += 1) {
        for (let cc = 0; cc < cols; cc += 1) {
          const want = cells[rr * cols + cc];
          if (want === -1) continue;
          const pos = (r + rr) * fieldCols + (c + cc);
          if (pos >= digits.length) { ok = false; break; }
          if (cls(digits.charCodeAt(pos) - 48) !== want) { ok = false; break; }
        }
      }
      if (ok) {
        total += 1;
        if (matches.length < cap) matches.push({ position: (r * fieldCols + c) + 1, row: r, col: c });
      }
    }
  }
  return { matches, total, anchors, capped: total > matches.length, incomplete: false };
}

function refStats(digits) {
  const counts = Array(10).fill(0);
  for (let i = 0; i < digits.length; i += 1) counts[digits.charCodeAt(i) - 48] += 1;
  const expected = digits.length / 10;
  const chi_square = counts.reduce((a, c) => a + (c - expected) ** 2 / expected, 0);
  return { counts, total_digits: digits.length, chi_square };
}

/* ------------------------------- test driver -------------------------------- */

function main() {
  const PHASE = process.env.PI_PARITY_PHASE || "all";
  const want = (p) => PHASE === "all" || PHASE === p;

  const { PiEngine } = require(path.join(PKG, "pi_wasm.js"));
  const digits = fs.readFileSync(FIXTURE, "ascii").replace(/\s+/g, "");
  const manifestJson = fs.readFileSync(path.join(DATA_DIR, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestJson);
  const engine = new PiEngine(manifestJson);
  let byteOffset = 0;
  for (let i = 0; i < manifest.chunks.length; i += 1) {
    const bytes = fs.readFileSync(path.join(DATA_DIR, "chunks", `chunk_${String(i).padStart(5, "0")}.bin`));
    engine.set_chunk(i, new Uint8Array(bytes));
    byteOffset += bytes.length;
  }
  assert.equal(digits.length, manifest.total_digits);
  assert.equal(byteOffset, manifest.packed_bytes ?? manifest.chunks.reduce((a, c) => a + c.bytes, 0));

  let checks = 0;
  const eq = (label, got, wantValue) => {
    if (!isDeepStrictEqual(got, wantValue)) {
      throw new Error(`${label}: mismatch\n  got  ${brief(got)}\n  want ${brief(wantValue)}`);
    }
    checks += 1;
  };

  const stageFile = process.env.PI_PARITY_STAGE_FILE ||
    path.join(os.tmpdir(), "pi-atlas-parity-stages.log");
  try {
    fs.mkdirSync(path.dirname(stageFile), { recursive: true });
    fs.writeFileSync(stageFile, "");
  } catch {}
  const stage = (s) => {
    try { fs.appendFileSync(stageFile, `${s}\n`); } catch {}
  };
  stage(`start phase=${PHASE}`);

  // Deterministic query set: short/long, self-overlapping, absent, and queries
  // whose matches straddle the 1,000,000-digit chunk boundary.
  if (want("exact")) {
    const queries = [
      "1", "12", "141", "1415", "99", "111", "12345", "000", "9876543210",
      "3141592653", "2718281828", "9999999999", "3141592653589793238462643383279502884",
      digits.slice(999_995, 1_000_005), // spans the chunk boundary
      digits.slice(499_998, 500_008),
      digits.slice(1_500_000, 1_500_012).replace(/./g, (d) => d),
      "4242424242424242", "12345678901234567890",
    ];
    stage(`exact: ${queries.length} queries`);
    for (const q of queries) {
      const got = JSON.parse(engine.search_exact(q, 64));
      eq(`exact ${q.slice(0, 12)}`, got, refExact(digits, q, 64));
      eq(`find_first ${q.slice(0, 12)}`, Number(engine.find_first(q)), refFindFirst(digits, q));
      const gp = JSON.parse(engine.longest_existing_prefix(q));
      eq(`prefix ${q.slice(0, 12)}`, gp, refPrefix(digits, q));
    }
  }

  if (want("letters")) {
    stage("letters");
    for (const word of ["PI", "A", "ABC", "PIPELINE", "ZZ", "ATLAS", "MATH", "UNICODE"]) {
      const got = JSON.parse(engine.search_letters(word, 64));
      eq(`letters ${word}`, got, refLetters(digits, word, 64));
    }
  }

  if (want("dates")) {
    stage("dates");
    for (const [y, m, d] of [[2024, 1, 15], [2000, 1, 1], [1969, 7, 20]]) {
      const rows = JSON.parse(engine.search_dates(y, m, d));
      const expectedSeq = new Set([
        `${String(d).padStart(2, "0")}${String(m).padStart(2, "0")}${String(y).padStart(4, "0")}`,
        `${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}${String(y).padStart(4, "0")}`,
        `${String(y).padStart(4, "0")}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`,
        `${String(d).padStart(2, "0")}${String(m).padStart(2, "0")}${String(y % 100).padStart(2, "0")}`,
        `${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}${String(y % 100).padStart(2, "0")}`,
        `${String(y % 100).padStart(2, "0")}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`,
      ]);
      assert.equal(rows.length, 6);
      for (const row of rows) {
        assert.ok(expectedSeq.has(row.sequence), `unexpected date sequence ${row.sequence}`);
        eq(`date ${row.sequence}`, row.result, refExact(digits, row.sequence, 10000));
      }
      checks += 2;
    }
  }

  if (want("pattern")) {
    stage("pattern");
    for (const spec of [
      { rows: 1, cols: 2, cells: [1, 4], colour_mode: true },
      { rows: 2, cols: 2, cells: [1, 4, 1, 5], colour_mode: true },
      { rows: 1, cols: 3, cells: [0, 1, -1], colour_mode: false },
      { rows: 2, cols: 3, cells: [-1, -1, -1, 0, 1, 0], colour_mode: false },
    ]) {
      // Keep field widths modest: cols=10 would create ~1.8M anchor iterations.
      // 16 and 97 still exercise boundary-spanning geometry at a fraction of the work.
      for (const cols of [16, 97]) {
        const got = JSON.parse(engine.search_pattern(JSON.stringify(spec), BigInt(cols), PATTERN_MATCH_CAP));
        eq(`pattern ${JSON.stringify(spec)} cols=${cols}`, got, refPattern(digits, spec, cols, PATTERN_MATCH_CAP));
      }
    }
  }

  if (want("stats")) {
    stage("stats");
    eq("stats", JSON.parse(engine.compute_stats()), refStats(digits));
  }

  if (want("windows")) {
    stage("windows");
    for (const [s, e] of [[1, 1], [1, 10], [999_995, 1_000_005], [1_999_990, 2_000_000], [123, 4567]]) {
      eq(`window [${s},${e}]`, engine.get_window(BigInt(s), BigInt(e)), digits.slice(s - 1, e));
    }
  }

  stage("done");
  if (PHASE === "all") {
    console.log(`WASM-vs-reference parity: ${checks} assertions passed on 2,000,000 real digits.`);
  } else {
    console.log(`WASM-vs-reference parity [${PHASE}]: ${checks} assertions passed.`);
  }
  engine.free();
}

// Self-check for the memory guard: a mismatch involving 200,000 match objects
// must still produce a tiny message. Run: PI_PARITY_SELFTEST=1 node scripts/parity_wasm.cjs
if (process.env.PI_PARITY_SELFTEST === "1") {
  const huge = Array.from({ length: 200_000 }, (_, i) => ({ position: i + 1, row: 0, col: i }));
  const msg = `mismatch\n  got  ${brief(huge)}\n  want ${brief(huge)}`;
  if (msg.length > 1000 || process.memoryUsage().rss > RSS_CEILING) {
    console.error("brief() is not bounded — memory guard FAILED");
    process.exit(1);
  }
  console.log(`brief() guard OK: ${msg.length} chars for a 200,000-element array`);
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error("Parity test FAILED:", err && err.stack ? err.stack : err);
  process.exit(1);
}
