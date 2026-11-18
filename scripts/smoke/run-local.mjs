/**
 * smoke:local lifecycle: build when stale, start `vite preview` on a free
 * port, run the smoke checks, and always stop the preview server afterwards.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DIST = path.join(ROOT, "dist");
const SOURCE = ["src", "public"].map((p) => path.join(ROOT, p));
const CONFIG = ["index.html", "vite.config.ts", "package.json", "tsconfig.json"].map((p) => path.join(ROOT, p));

function newest(base, filter = () => true) {
  let latest = 0;
  function walk(target) {
    if (!fs.existsSync(target)) return;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target)) walk(path.join(target, name));
    } else if (filter(target)) {
      latest = Math.max(latest, stat.mtimeMs);
    }
  }
  walk(base);
  return latest;
}

function needsBuild() {
  const built = path.join(DIST, "index.html");
  if (!fs.existsSync(built)) return true;
  const outputTime = fs.statSync(built).mtimeMs;
  const sourceTime = Math.max(
    ...SOURCE.map((p) => newest(p, (f) => !/chunks[\/\\]/.test(f))),
    ...CONFIG.map((p) => (fs.existsSync(p) ? fs.statSync(p).mtimeMs : 0)),
  );
  return sourceTime > outputTime;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitReady(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // preview is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`vite preview did not start at ${url}`);
}

const built = needsBuild();
if (built) {
  console.log("smoke:local — building stale or missing dist/");
  const build = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
} else {
  console.log("smoke:local — reusing current dist/");
}

const port = await freePort();
const url = `http://127.0.0.1:${port}/`;
const server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
  cwd: ROOT,
  stdio: "ignore",
  detached: true,
});

let status = 1;
try {
  await waitReady(url);
  console.log(`smoke:local — preview at ${url}`);
  const smoke = spawnSync("node", [path.join(ROOT, "scripts/smoke/smoke.mjs"), "--base-url", url], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  status = smoke.status ?? 1;
} catch (err) {
  console.error(`smoke:local — ${err instanceof Error ? err.message : String(err)}`);
} finally {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
}
process.exit(status);
