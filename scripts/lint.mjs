/**
 * Lightweight repo lint: no ESLint dependency is needed for the rules that
 * matter here. Checks source/tests for placeholder markers, stray console.log
 * calls, and trailing whitespace. Runs in milliseconds on CI and locally.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIRS = ["src", "tests"];
const EXTS = new Set([".ts", ".tsx", ".css", ".js", ".mjs"]);
const problems = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (EXTS.has(path.extname(entry.name))) check(full);
  }
}

function check(file) {
  const text = fs.readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    const where = `${path.relative(ROOT, file)}:${i + 1}`;
    if (/\b(TODO|FIXME|PLACEHOLDER)\b/.test(line)) problems.push(`${where}: placeholder marker`);
    if (/console\.log\s*\(/.test(line)) problems.push(`${where}: console.log`);
    if (/[ \t]+$/.test(line)) problems.push(`${where}: trailing whitespace`);
  });
}

for (const dir of DIRS) walk(path.join(ROOT, dir));

if (problems.length) {
  console.error(`lint: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
  process.exit(1);
}
console.log("lint: clean");
