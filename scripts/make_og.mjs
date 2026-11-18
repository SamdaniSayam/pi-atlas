// Generates public/og.png — the 1200×630 social-sharing card for π Atlas.
//
// Renders an inline HTML template with the app's real self-hosted fonts and a
// real slice of the verified dataset, then screenshots it with Playwright's
// bundled Chromium. Run: node scripts/make_og.mjs  (requires `npx playwright
// install chromium` once).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "public", "og.png");
const WIDTH = 1200;
const HEIGHT = 630;

// A real, contiguous slice of the dataset (digits 1–336 of π), straight from
// the verified file — nothing invented for the card.
const DATASET = await readFile(path.join(root, "public", "pi-2m.txt"), "utf8");
const digits = DATASET.replace(/\D/g, "").slice(0, 336);

const row = (from, to) =>
  digits
    .slice(from, to)
    .split("")
    .map((d) => `<span class="d d${d}">${d}</span>`)
    .join("");

const font = async (name) =>
  `data:font/woff2;base64,${await readFile(
    path.join(root, "src", "assets", "fonts", name),
  ).toString("base64")}`;

const [fraunces, inter, mono] = await Promise.all([
  font("Fraunces-600.woff2"),
  font("Inter-400.woff2"),
  font("JetBrainsMono-400.woff2"),
]);

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face { font-family: "Fraunces"; src: url("${fraunces}") format("woff2"); font-weight: 600; }
  @font-face { font-family: "Inter"; src: url("${inter}") format("woff2"); font-weight: 400; }
  @font-face { font-family: "JetBrains Mono"; src: url("${mono}") format("woff2"); font-weight: 400; }
  * { margin: 0; box-sizing: border-box; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
    background: #0b0d12;
    color: #e8eaf0;
    font-family: "Inter", sans-serif;
    display: flex; flex-direction: column;
  }
  .glow {
    position: absolute; inset: 0;
    background:
      radial-gradient(700px 420px at 12% -10%, rgba(240,180,41,0.16), transparent 60%),
      radial-gradient(640px 400px at 95% 115%, rgba(64,150,238,0.18), transparent 60%);
  }
  .frame {
    position: relative; flex: 1;
    display: flex; flex-direction: column;
    padding: 56px 64px 48px;
  }
  .brand { display: flex; align-items: center; gap: 18px; }
  .pi {
    font-family: "Fraunces", serif; font-weight: 600;
    font-size: 76px; line-height: 1; color: #f0b429;
  }
  .name {
    font-family: "Fraunces", serif; font-weight: 600;
    font-size: 54px; line-height: 1; letter-spacing: 0.01em;
  }
  .tagline { margin-top: 14px; font-size: 26px; color: #aab2c5; }
  .stream {
    margin-top: auto;
    font-family: "JetBrains Mono", monospace;
    font-size: 21.5px; line-height: 1.55; letter-spacing: 0.06em;
    white-space: nowrap;
    mask-image: linear-gradient(to right, black 78%, transparent);
  }
  .d { border-radius: 5px; padding: 1px 2px; }
  .d3 { color: #f0b429; background: rgba(240,180,41,0.14); }
  .d1 { color: #86c8b4; }
  .d4 { color: #e8927c; } .d5 { color: #c9a5e8; } .d9 { color: #e8a5c0; }
  .d2 { color: #9fd08c; } .d6 { color: #8fb7e8; } .d7 { color: #e8c98f; }
  .d0 { color: #7c8698; } .d8 { color: #a8b2c8; }
  .digits { color: #dfe3ec; }
  .search {
    position: absolute; right: 64px; top: 200px;
    font-family: "JetBrains Mono", monospace; font-size: 20px;
    color: #0b0d12; background: #f0b429;
    padding: 10px 18px; border-radius: 999px; font-weight: 700;
  }
  .footer {
    margin-top: 26px; display: flex; justify-content: space-between;
    font-size: 19px; color: #7c8698;
  }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="frame">
    <div class="brand"><span class="pi">π</span><span class="name">Atlas</span></div>
    <div class="tagline">Two million digits. Every number, word, colour and shape — hiding somewhere.</div>
    <div class="search">999999 · digit 762</div>
    <div class="stream digits">
${row(0, 112)}<br>
${row(112, 224)}<br>
${row(224, 336)}
    </div>
    <div class="footer">
      <span>3.14159265358979… — computed, verified, yours to explore</span>
      <span>runs entirely in your browser</span>
    </div>
  </div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
await browser.close();
await writeFile(OUT, png);
console.log(`Wrote ${OUT} (${(png.length / 1024).toFixed(1)} KiB, ${WIDTH}×${HEIGHT})`);
