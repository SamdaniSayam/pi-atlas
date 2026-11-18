/** E2E for the Wish Card QR visitor banner, against the dev server + real dataset. */
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { datasetWords } from "../../src/wishcard/copy";

test.describe.configure({ mode: "serial" });

const AXE = path.resolve(process.cwd(), "node_modules/axe-core/axe.min.js");
const JSQR = path.resolve(process.cwd(), "node_modules/jsqr/dist/jsQR.js");
const BANNER = '[role="region"][aria-label="Shared result"]';
const CARD = 'section[aria-label="Your wish card"]';

let consoleErrors: string[];

test.beforeEach(({ page }: { page: Page }) => {
  consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

async function openBanner(page: Page, url: string, text: RegExp | string) {
  await page.goto(url);
  const banner = page.locator(BANNER);
  await expect(banner).toBeVisible({ timeout: 90_000 });
  await expect(banner).toContainText(text, { timeout: 90_000 });
  return banner;
}

test("digits: found banner, then Search your own clears the URL and focuses the input", async ({ page }) => {
  await openBanner(page, "/#/explore/digits?q=12&src=card", "Someone found 12 in π at position 148. Try your own.");
  expect(await page.locator(BANNER).evaluate((el) => el.contains(document.activeElement))).toBe(false);
  await page.getByRole("button", { name: "Search your own" }).click();
  await expect(page.locator(BANNER)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).hash).toBe("#/explore/digits");
  await expect(page.locator("#digits-q")).toBeFocused();
  await expect(page.locator("#digits-q")).toHaveValue("");
});

test("digits: Dismiss keeps the result and removes only src", async ({ page }) => {
  await openBanner(page, "/#/explore/digits?q=12&src=card", "position 148");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator(BANNER)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).hash).toBe("#/explore/digits?q=12");
  await expect(page.getByText("Query “12”")).toBeVisible();
});

test("digits: Esc while focus is inside the banner dismisses it", async ({ page }) => {
  await openBanner(page, "/#/explore/digits?q=12&src=card", "position 148");
  await page.getByRole("button", { name: "Search your own" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(BANNER)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).hash).toBe("#/explore/digits?q=12");
});

test("digits: no banner without src or with a wrong src value", async ({ page }) => {
  for (const url of ["/#/explore/digits?q=12", "/#/explore/digits?q=12&src=evil"]) {
    await page.goto(url);
    await expect(page.getByText("FOUND", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(BANNER)).toHaveCount(0);
  }
});

test("digits: not-found 20-digit query uses the real dataset size", async ({ page }) => {
  await page.goto("/#/explore/digits?q=12345678901234567890&src=card");
  const banner = page.locator(BANNER);
  await expect(banner).toBeVisible({ timeout: 90_000 });
  // Read the manifest the app actually loaded (2M locally, 1B in production).
  const totalDigits = await page.evaluate(async () => {
    const url = new URL("data/pi-2m/web-manifest.json", document.baseURI).toString();
    const response = await fetch(url);
    const manifest = (await response.json()) as { totalDigits: number };
    return manifest.totalDigits;
  });
  await expect(banner).toContainText(
    `wasn’t in the first ${datasetWords(totalDigits)} digits`,
    { timeout: 90_000 },
  );
  await expect(banner).toContainText("12345678901234567890");
});

test("digits: no query in the URL shows the generic banner", async ({ page }) => {
  await openBanner(page, "/#/explore/digits?src=card", "Someone shared a search of π with you. Try your own.");
});

test("letters and shapes use their own result values", async ({ page }) => {
  await openBanner(page, "/#/explore/letters?q=PI&src=card", /Someone found PI in π at position [\d,]+\. Try your own\./);
  const cells = encodeURIComponent(JSON.stringify([0, 0, 0, 0, 1, 0, 0, 0, 0]));
  await openBanner(
    page,
    `/#/explore/shapes?p=${cells}&pr=3&pc=3&w=48&src=card`,
    /Someone found a shape in π at row \d+, column \d+\. Try your own\./,
  );
});

test("a real Wish Card QR carries src=card and opens the banner", async ({ page }) => {
  await page.goto("/#/explore/digits?q=12");
  await expect(page.getByText("FOUND", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(`${CARD} canvas`)).toBeVisible({ timeout: 90_000 });
  await page.addScriptTag({ path: JSQR });
  const decoded = await page.evaluate((selector) => {
    const canvas = document.querySelector(`${selector} canvas`) as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const size = 172;
    const data = ctx.getImageData(836, 836, size, size).data;
    const jsQR = (window as unknown as {
      jsQR: (d: Uint8ClampedArray, w: number, h: number, o?: unknown) => { data: string } | null;
    }).jsQR;
    return jsQR(data, size, size, { inversionAttempts: "dontInvert" })?.data ?? null;
  }, CARD);
  expect(decoded).toContain("src=card");
  await openBanner(page, decoded!, "Someone found 12 in π at position 148. Try your own.");
});

test("mobile 390×844: banner fits, no horizontal scroll, no first-load height shift", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/explore/digits?q=12&src=card");
  const slot = page.locator(".shared-banner-slot");
  await expect(slot).toBeVisible();
  const firstHeight = await slot.evaluate((el) => el.getBoundingClientRect().height);
  await expect(page.locator(BANNER)).toContainText("position 148", { timeout: 90_000 });
  const finalHeight = await slot.evaluate((el) => el.getBoundingClientRect().height);
  expect(finalHeight).toBe(firstHeight);
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  const box = await page.locator(BANNER).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.width).toBeLessThanOrEqual(390);
});

test("banner has no serious or critical axe violations", async ({ page }) => {
  await openBanner(page, "/#/explore/digits?q=12&src=card", "position 148");
  await page.addScriptTag({ path: AXE });
  const results = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: unknown[] }> }> } }).axe;
    const report = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return report.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => (n as { target: string[] }).target.join(" ")).join(" | ")}`);
  });
  expect(results).toEqual([]);
});

test("src=card is stripped silently outside the Explorer", async ({ page }) => {
  for (const route of ["/#/", "/#/probability", "/#/about"]) {
    await page.goto(`${route}?src=card`);
    await expect.poll(() => new URL(page.url()).hash).not.toContain("src=card");
    await expect(page.locator(BANNER)).toHaveCount(0);
  }
});
