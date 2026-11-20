/**
 * Pre-deploy smoke test: sequential, read-only browser checks against either a
 * local preview or an explicit live URL. Chromium only, one page at a time.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { SmokeHarness } from "./helpers.mjs";

// Decode QR plates in Node rather than injecting jsQR into the page: the
// production build sets a strict CSP (`script-src 'self' 'wasm-unsafe-eval'`)
// that blocks page.addScriptTag's inline injection. CDP evaluate (used to read
// canvas pixels) is not subject to CSP.
const require = createRequire(import.meta.url);
const jsQR = require("jsqr");

// Short allow-list for known-harmless failed requests. Empty by default.
const ALLOW_FAILED_REQUESTS = [];

const ROOT = path.resolve(process.cwd());
const BANNER = '[role="region"][aria-label="Shared result"]';
const WISH = 'section[aria-label="Your wish card"]';
const QR_PLATES = {
  collectible: {
    square: { x: 836, y: 836, size: 172 },
    story: { x: 72, y: 1330, size: 220 },
    wide: { x: 872, y: 120, size: 220 },
  },
  clean: {
    square: { x: 836, y: 836, size: 172 },
    story: { x: (1080 - 260) / 2, y: 1300, size: 260 },
    wide: { x: 872, y: 120, size: 220 },
  },
};
const PNG_SIZES = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  wide: { width: 1200, height: 630 },
};
const PNG_BUDGETS = {
  square: 1.5 * 1024 * 1024,
  story: 2.2 * 1024 * 1024,
  wide: 1.0 * 1024 * 1024,
};
const FORMAT_LABELS = { square: "Square", story: "Story", wide: "Wide" };
// First digits of π, used to build tier queries sized from the loaded dataset.
const PI_DIGITS = "14159265358979323846264338327950288419716939937510";
const DATE_STRINGS = ["07092006", "09072006", "20060907", "070906", "090706", "060907"];

function parseArgs() {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const at = args.indexOf("--base-url");
  let baseURL = at >= 0 ? args[at + 1] : process.env.SMOKE_BASE_URL ?? "";
  if (live && !process.env.SMOKE_BASE_URL) {
    console.error("smoke:live needs SMOKE_BASE_URL. Example:");
    console.error("  SMOKE_BASE_URL=https://user.github.io/pi-atlas/ npm run smoke:live");
    process.exit(2);
  }
  if (!baseURL) {
    console.error("smoke: no target URL. Use --base-url or SMOKE_BASE_URL.");
    process.exit(2);
  }
  // Live targets serve the full 1B dataset over the public internet. A cold
  // visit (or a fresh browser context) downloads ~478 MiB before the first
  // result, which can take well over a minute; local preview is fast. Keep UI
  // micro-interaction waits short, but scale data-dependent waits to reality.
  const actionTimeout = process.env.SMOKE_TIMEOUT_MS
    ? Number.parseInt(process.env.SMOKE_TIMEOUT_MS, 10)
    : live ? 300_000 : 60_000;
  if (!Number.isInteger(actionTimeout) || actionTimeout <= 0) {
    console.error("smoke: SMOKE_TIMEOUT_MS must be a positive integer (milliseconds).");
    process.exit(2);
  }
  return {
    baseURL: baseURL.endsWith("/") ? baseURL : `${baseURL}/`,
    live,
    actionTimeout,
    skip: new Set((process.env.SMOKE_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
    expectDigits: process.env.SMOKE_EXPECT_DIGITS ? Number.parseInt(process.env.SMOKE_EXPECT_DIGITS, 10) : null,
  };
}

const cfg = parseArgs();
const harness = new SmokeHarness({ ...cfg, allow: ALLOW_FAILED_REQUESTS });
const route = (hash) => new URL(hash.startsWith("#") ? hash : `#${hash}`, cfg.baseURL).toString();

async function waitFor(page, text, timeout = cfg.actionTimeout) {
  await page.waitForFunction((needle) => (document.body.textContent ?? "").includes(needle), text, { timeout });
}

/** Hash-only navigations are same-document, so force a fresh app mount. */
async function gotoHash(page, hash) {
  await page.goto(route(hash));
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function openDialog(page) {
  await page.getByRole("button", { name: "Customize" }).click();
  await page.locator('[role="dialog"]').waitFor({ state: "visible", timeout: 10_000 });
}

async function decodeQr(page, selector, format = "square", style = "collectible") {
  const plate = QR_PLATES[style][format];
  const base64 = await page.evaluate(({ sel, p }) => {
    const canvas = document.querySelector(sel);
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const data = ctx.getImageData(p.x, p.y, p.size, p.size).data;
    let binary = "";
    for (let i = 0; i < data.length; i += 1) binary += String.fromCharCode(data[i]);
    return btoa(binary);
  }, { sel: selector, p: plate });
  if (!base64) return null;
  const rgba = new Uint8ClampedArray(Buffer.from(base64, "base64"));
  return jsQR(rgba, plate.size, plate.size, { inversionAttempts: "dontInvert" })?.data ?? null;
}

async function pngInfo(file) {
  const data = await fs.readFile(file);
  assert.equal(data.subarray(1, 4).toString("ascii"), "PNG", "not a PNG file");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), bytes: data.length };
}

async function main() {
  await harness.launch();
  const ctx = await harness.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await harness.newPage(ctx);

  let totalDigits = 0;
  let shareUrl = "";
  let qr12 = "";
  let firstResultMs = 0;

  await harness.check("home-loads", async () => {
    const response = await page.goto(cfg.baseURL, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, "home did not return 200");
    assert.match(await page.title(), /π Atlas/, "app title missing");
    await page.locator("h1").filter({ hasText: "Is everything hiding in" }).waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(
      () => (document.body.textContent ?? "").includes("verified") && (document.body.textContent ?? "").includes("served live"),
      undefined,
      { timeout: cfg.actionTimeout },
    );
    return "home 200, title and hero visible";
  }, { usePage: page });

  await harness.check("manifest-ok", async () => {
    assert.ok(harness.manifestResponse, "app did not request a web manifest");
    assert.equal(harness.manifestResponse.status(), 200, "manifest request failed");
    const manifest = await harness.manifestResponse.json();
    totalDigits = Number(manifest.totalDigits ?? manifest.total_digits);
    assert.ok(Number.isInteger(totalDigits) && totalDigits > 0, "total_digits is not a positive integer");
    if (cfg.expectDigits !== null) {
      assert.equal(totalDigits, cfg.expectDigits, "total_digits differs from SMOKE_EXPECT_DIGITS");
    }
    await gotoHash(page, "#/about");
    const words = totalDigits.toLocaleString("en-US");
    await waitFor(page, words, 30_000);
    assert.match(await page.locator("body").innerText(), new RegExp(`${words.replaceAll(",", "\\,")} decimal digits`));
    return `total_digits=${totalDigits}; UI shows ${words}`;
  }, { usePage: page });

  await harness.check("digits-12", async () => {
    const started = Date.now();
    await gotoHash(page, "#/explore/digits?q=12");
    await page.getByText("FOUND", { exact: true }).waitFor({ state: "visible", timeout: cfg.actionTimeout });
    await waitFor(page, "position 148", cfg.actionTimeout);
    firstResultMs = Date.now() - started;
    await page.getByRole("button", { name: /copy link/i }).click();
    shareUrl = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(shareUrl, /q=12/, "share link lost the query");
    return `first position 148 in ${firstResultMs} ms`;
  }, { usePage: page });

  await harness.check("deep-link-roundtrip", async () => {
    assert.ok(shareUrl, "no share URL: digits-12 did not complete");
    const fresh = await harness.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await harness.newPage(fresh);
    await p.goto(shareUrl);
    await p.getByText("FOUND", { exact: true }).waitFor({ state: "visible", timeout: cfg.actionTimeout });
    await waitFor(p, "position 148", cfg.actionTimeout);
    return "fresh context restored position 148";
  }, { usePage: page });

  await harness.check("digits-feynman", async () => {
    await gotoHash(page, "#/explore/digits?q=999999");
    await page.getByText("FOUND", { exact: true }).waitFor({ state: "visible", timeout: cfg.actionTimeout });
    await waitFor(page, "position 762", cfg.actionTimeout);
    return "first position 762";
  }, { usePage: page });

  await harness.check("digits-not-found", async () => {
    await gotoHash(page, "#/explore/digits?q=98765432109876543210");
    await page.getByText("NOT FOUND", { exact: true }).waitFor({ state: "visible", timeout: cfg.actionTimeout });
    return "not-found result rendered without a crash";
  }, { usePage: page });

  await harness.check("letters-pi", async () => {
    await gotoHash(page, "#/explore/letters");
    await page.getByLabel(/word \(1–12 letters/i).fill("PI");
    await page.getByRole("button", { name: /search both frames/i }).click();
    await page.getByText(/Total matches \(both frames\)/i).waitFor({ state: "visible", timeout: cfg.actionTimeout });
    return "PI found in letters explorer";
  }, { usePage: page });

  await harness.check("shapes-preset", async () => {
    const started = Date.now();
    await gotoHash(page, "#/explore/shapes");
    await page.getByRole("button", { name: "Plus", exact: true }).click();
    await page.getByRole("button", { name: "Search pattern" }).click();
    await page.getByText("Matches in dataset").waitFor({ state: "visible", timeout: cfg.actionTimeout });
    const elapsed = Date.now() - started;
    return `shape result in ${elapsed} ms${elapsed > 20_000 ? " (slow)" : ""}`;
  }, { usePage: page });

  await harness.check("wishcard-download", async () => {
    const cases = [
      { query: "12", slug: "12", heading: "Lucky" },
      { query: "98765432109876543210", slug: "98765432109876543210", heading: "Twilight" },
    ];
    const details = [];
    for (const c of cases) {
      await gotoHash(page, `#/explore/digits?q=${c.query}`);
      await page.getByText("FOUND", { exact: true })
        .or(page.getByText("NOT FOUND", { exact: true }))
        .first().waitFor({ state: "visible", timeout: cfg.actionTimeout });
      await page.getByRole("heading", { name: `You earned a ${c.heading} card` })
        .waitFor({ state: "visible", timeout: 30_000 });
      await page.locator(`${WISH} canvas`).waitFor({ state: "visible", timeout: cfg.actionTimeout });
      await openDialog(page);
      for (const format of ["square", "story", "wide"]) {
        await page.locator("label.chip").filter({ hasText: FORMAT_LABELS[format] }).first().click();
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: cfg.actionTimeout }),
          page.getByRole("button", { name: "Download PNG" }).click(),
        ]);
        const file = `pi-atlas-wish-digits-${c.slug}-${format}.png`;
        assert.equal(download.suggestedFilename(), file, "unexpected PNG file name");
        const info = await pngInfo(await download.path());
        const expected = PNG_SIZES[format];
        assert.equal(info.width, expected.width, `${format} PNG width`);
        assert.equal(info.height, expected.height, `${format} PNG height`);
        assert.ok(info.bytes < PNG_BUDGETS[format],
          `${format} PNG ${info.bytes} B is over ${PNG_BUDGETS[format]} B budget`);
        details.push(`${file} ${info.width}×${info.height} ${info.bytes}B`);
      }
      await page.getByRole("button", { name: "Close", exact: true }).click();
    }
    return details.join("; ");
  }, { usePage: page });

  await harness.check("wishcard-tiers", async () => {
    // Query lengths scale with the loaded dataset so the expected count (and
    // therefore the tier) is stable on both the local 2M and shipped 1B builds.
    const exp10 = Math.floor(Math.log10(totalDigits));
    const cases = [
      { tier: "Legendary", query: PI_DIGITS.slice(0, exp10 + 3) },
      { tier: "Rare", query: PI_DIGITS.slice(0, exp10 + 1) },
      { tier: "Lucky", query: PI_DIGITS.slice(0, exp10 - 1) },
      { tier: "Twilight", query: "12345678901234567890" },
    ];
    const seen = [];
    for (const c of cases) {
      await gotoHash(page, `#/explore/digits?q=${c.query}`);
      await page.getByText("FOUND", { exact: true })
        .or(page.getByText("NOT FOUND", { exact: true }))
        .first().waitFor({ state: "visible", timeout: cfg.actionTimeout });
      await page.getByRole("heading", { name: `You earned a ${c.tier} card` })
        .waitFor({ state: "visible", timeout: 30_000 });
      await openDialog(page);
      const label = await page.locator('[role="dialog"] [role="img"][aria-label^="Wish card,"]')
        .getAttribute("aria-label");
      assert.ok(label?.includes(`${c.tier} tier`), `wrong tier pill for ${c.query}: ${label}`);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      seen.push(`${c.tier}:${c.query.length}d`);
    }
    return seen.join(", ");
  }, { usePage: page });

  await harness.check("wishcard-qr-host", async () => {
    await gotoHash(page, "#/explore/digits?q=12");
    await page.getByText("FOUND", { exact: true }).waitFor({ state: "visible", timeout: cfg.actionTimeout });
    await page.locator(`${WISH} canvas`).waitFor({ state: "visible", timeout: cfg.actionTimeout });
    await openDialog(page);
    qr12 = await decodeQr(page, '[role="dialog"] canvas');
    assert.ok(qr12, "card QR did not decode");
    assert.equal(new URL(qr12).origin, new URL(cfg.baseURL).origin, "QR points at another origin");
    assert.match(qr12, /src=card/, "QR is missing the card marker");
    return `origin ${new URL(qr12).origin}, src=card present`;
  }, { usePage: page });

  await harness.check("wishcard-fonts", async () => {
    await page.evaluate(() => document.fonts.ready);
    const checks = await page.evaluate(() => ({
      fraunces: document.fonts.check('600 24px "Fraunces"'),
      inter: document.fonts.check('600 24px "Inter"'),
      mono: document.fonts.check('500 24px "JetBrains Mono"'),
    }));
    assert.ok(checks.fraunces && checks.inter && checks.mono, JSON.stringify(checks));
    const urls = await page.evaluate(() => {
      const out = new Set();
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (!(rule instanceof CSSFontFaceRule)) continue;
          const re = /url\((['"]?)([^'")]+)\1\)/g;
          let match;
          while ((match = re.exec(rule.style.src))) out.add(new URL(match[2], sheet.href || document.baseURI).href);
        }
      }
      return [...out];
    });
    assert.ok(urls.length > 0, "no @font-face URLs found");
    const statuses = await page.evaluate(async (list) => Promise.all(list.map(async (url) => {
      const response = await fetch(url, { method: "HEAD" });
      return { url, status: response.status };
    })), urls);
    const bad = statuses.filter((s) => s.status !== 200);
    assert.equal(bad.length, 0, `font files not 200: ${JSON.stringify(bad)}`);
    const observedBad = harness.fontResponses.filter(
      (f) => f.status >= 400 || (f.status === 200 && !f.type.includes("font/woff2")),
    );
    assert.equal(observedBad.length, 0, `bad observed font responses: ${JSON.stringify(observedBad)}`);
    return `${urls.length} font files 200, ${harness.fontResponses.length} observed font responses, Fraunces/Inter/Mono available`;
  }, { usePage: page });

  await harness.check("banner-from-qr", async () => {
    assert.ok(qr12, "no QR URL: wishcard-qr-host did not complete");
    const fresh = await harness.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await harness.newPage(fresh);
    await p.goto(qr12);
    const banner = p.locator(BANNER);
    await banner.waitFor({ state: "visible", timeout: cfg.actionTimeout });
    await waitFor(p, "position 148", cfg.actionTimeout);
    assert.match(await banner.innerText(), /position 148/);
    await p.getByRole("button", { name: "Search your own" }).click();
    await banner.waitFor({ state: "detached", timeout: 10_000 });
    assert.ok(!new URL(p.url()).hash.includes("src"), "src=card was not removed");
    await p.locator("#digits-q").waitFor({ state: "visible", timeout: 10_000 });
    // SharedBanner focuses on the next macrotask so React can finish the
    // navigation; wait for it instead of racing the timer.
    await p.waitForFunction(() => document.activeElement?.id === "digits-q", undefined, { timeout: 5_000 });
    assert.equal(await p.evaluate(() => document.activeElement?.id), "digits-q", "input is not focused");
    assert.equal(await p.locator("#digits-q").inputValue(), "", "input is not empty");
    return "banner shown, dismissed, input focused and empty";
  }, { usePage: page });

  await harness.check("wishcard-hide-digits", async () => {
    await gotoHash(page, "#/explore/dates");
    await page.locator("#date-q").fill("2006-09-07");
    await page.getByRole("button", { name: /search six formats/i }).click();
    await waitFor(page, "Format comparison", cfg.actionTimeout);
    // The date helper's "Open in Number Explorer" action opens this exact deep
    // link (d=1 marks it as a date-helper search); navigate to it directly so
    // the check does not depend on that button's timing.
    await gotoHash(page, "#/explore/digits?q=07092006&d=1");
    await page.getByText("FOUND", { exact: true }).waitFor({ state: "visible", timeout: cfg.actionTimeout });
    await page.locator(`${WISH} canvas`).waitFor({ state: "visible", timeout: cfg.actionTimeout });
    await openDialog(page);
    assert.equal(await page.getByRole("checkbox", { name: /hide my digits/i }).isChecked(), true,
      "date helper did not default to Hide my digits");
    const decoded = await decodeQr(page, '[role="dialog"] canvas');
    assert.ok(decoded, "hidden card QR did not decode");
    await page.getByRole("button", { name: "Copy caption" }).click();
    const caption = await page.evaluate(() => navigator.clipboard.readText());
    for (const value of DATE_STRINGS) {
      assert.ok(!decoded.includes(value), `QR leaked ${value}`);
      assert.ok(!caption.includes(value), `caption leaked ${value}`);
    }
    return "QR and caption contain none of the six date strings";
  }, { usePage: page });

  await harness.check("mobile-layout", async () => {
    const mobile = await harness.newContext({ viewport: { width: 390, height: 844 } });
    const p = await harness.newPage(mobile);
    const paths = [
      "#/",
      "#/explore/digits?q=12",
      "#/explore/shapes",
      "#/probability",
      "#/about",
    ];
    const overflow = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    for (const hash of paths) {
      await gotoHash(p, hash);
      assert.ok(await overflow(), `horizontal overflow at ${hash}`);
    }
    await gotoHash(p, "#/explore/digits?q=12");
    await p.locator(`${WISH} canvas`).waitFor({ state: "visible", timeout: cfg.actionTimeout });
    await openDialog(p);
    assert.ok(await overflow(), "horizontal overflow with the wish card dialog open");
    assert.ok(qr12, "no QR URL: wishcard-qr-host did not complete");
    await p.goto(qr12);
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.locator(BANNER).waitFor({ state: "visible", timeout: cfg.actionTimeout });
    assert.ok(await overflow(), "horizontal overflow with the banner open");
    return "390×844: 5 routes, dialog and banner fit";
  }, { usePage: page });

  await harness.check("prod-hygiene", async () => {
    if (!cfg.live) {
      const dir = path.join(ROOT, "dist");
      const files = [];
      async function walk(d) {
        for (const entry of await fs.readdir(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (/\.(js|css|html|json)$/.test(entry.name)) files.push(full);
        }
      }
      await walk(dir);
      const hits = [];
      for (const file of files) {
        if ((await fs.readFile(file, "utf8")).includes("dev/wish")) hits.push(path.relative(ROOT, file));
      }
      assert.equal(hits.length, 0, `dev/wish found in ${hits.join(", ")}`);
      return `no dev/wish in ${files.length} built files`;
    }
    await gotoHash(page, "#/dev/wish");
    await assert.rejects(
      () => page.getByRole("heading", { name: /wish card gallery/i }).waitFor({ state: "visible", timeout: 3_000 }),
      /Timeout|timed out/,
    );
    return "no dev gallery on the live site";
  }, { usePage: page });

  await harness.check("no-console-errors", async () => {
    assert.deepEqual(harness.consoleErrors, [], "console errors or page errors were logged");
    return "0 console errors, 0 page errors";
  }, { usePage: page });

  await harness.check("no-failed-requests", async () => {
    assert.deepEqual(harness.failedRequests, [], "requests failed or returned >=400");
    return `0 failed requests (allow-list: ${ALLOW_FAILED_REQUESTS.length})`;
  }, { usePage: page });

  // A cold live visit includes the full 1B dataset download, so the local
  // 5 s budget is meaningless there; still flag genuinely pathological waits.
  const firstResultBudget = cfg.live ? cfg.actionTimeout : 5_000;
  harness.soft("first-result-time", firstResultMs > firstResultBudget,
    `${firstResultMs} ms (warn over ${firstResultBudget} ms)`);
  harness.soft("data-transfer", harness.bytes > 60 * 1024 * 1024,
    `${(harness.bytes / 1024 / 1024).toFixed(2)} MB (warn over 60 MB)`);
  const heap = await page.evaluate(() => (performance.memory?.usedJSHeapSize ?? 0));
  harness.soft("memory-hint", false, heap ? `${(heap / 1024 / 1024).toFixed(1)} MB JS heap` : "not available in this browser");

  const result = await harness.writeReports(cfg.baseURL);
  console.log(harness.summary());
  console.log(`\nTarget: ${cfg.baseURL}`);
  console.log(`Console errors: ${harness.consoleErrors.length} · Failed requests: ${harness.failedRequests.length}`);
  console.log(`Bytes transferred: ${harness.bytes}`);
  console.log(`RESULT: ${result}`);
  await harness.close();
  process.exit(result === "PASS" ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`smoke: unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
  await harness.writeReports(cfg.baseURL);
  await harness.close();
  process.exit(1);
});
