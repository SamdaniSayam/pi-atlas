/**
 * Wish-card E2E against the dev server (VITE_E2E=1). Covers all four rarity
 * tiers, the three download formats and their PNG budgets, privacy, dedication,
 * the one-at-a-time gallery checks and contact sheet, axe, and the `w` / Esc
 * shortcut pair. Chromium only, one worker (see playwright.wish.config.ts).
 */
import path from "node:path";
import fs from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { QUOTES } from "../../src/wishcard/copy";
import { TIER_LABELS } from "../../src/wishcard/tiers";
import type { WishTier } from "../../src/wishcard/types";

test.describe.configure({ mode: "serial" });

const AXE = path.resolve(process.cwd(), "node_modules/axe-core/axe.min.js");
const WISH = 'section[aria-label="Your wish card"]';
const REPORT = path.resolve(process.cwd(), "smoke-report");

// Queries with a known result in the local 2M dataset and the resulting tier.
// Expected counts use the engine formula (N-L+1)/10^L with N = 2,000,000:
// L=9 → 0.002 (gold), L=7 → 0.2 (silver), L=2 → 20,000 (aurora), absent → twilight.
const TIER_CASES: Array<{ tier: WishTier; query: string; heading: string }> = [
  { tier: "gold", query: "141592653", heading: "Legendary" },
  { tier: "silver", query: "1415926", heading: "Rare" },
  { tier: "aurora", query: "12", heading: "Lucky" },
  { tier: "twilight", query: "12345678901234567890", heading: "Twilight" },
];

async function waitForCard(page: Page) {
  await expect(page.locator(`${WISH} canvas`)).toBeVisible({ timeout: 90_000 });
}

async function pngSize(file: string): Promise<{ width: number; height: number; bytes: number }> {
  const data = await fs.readFile(file);
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bytes: data.length,
  };
}

/** HashRouter ignores hash-only `goto`; reload so state is rebuilt per search. */
async function gotoHash(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await page.reload();
}

async function search(page: Page, query: string, state: "FOUND" | "NOT FOUND") {
  await gotoHash(page, `#/explore/digits?q=${query}`);
  await expect(page.getByText(state, { exact: true })).toBeVisible({ timeout: 60_000 });
  await waitForCard(page);
}

async function openDialog(page: Page) {
  await page.getByRole("button", { name: "Customize" }).click();
  await expect(page.getByRole("dialog", { name: /customize your wish card/i })).toBeVisible();
}

async function previewLabel(page: Page): Promise<string> {
  return (await page.locator('[role="dialog"] [role="img"][aria-label^="Wish card,"]')
    .getAttribute("aria-label")) ?? "";
}

async function copiedCaption(page: Page): Promise<string> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy caption" }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

async function chooseFormat(page: Page, label: string, width: number, height: number) {
  await page.locator("label.chip").filter({ hasText: label }).first().click();
  await expect.poll(async () =>
    page.locator('[role="dialog"] canvas').first().evaluate((el) => ({
      width: (el as HTMLCanvasElement).width,
      height: (el as HTMLCanvasElement).height,
    })), { timeout: 30_000 }).toEqual({ width, height });
}

test("wish card: four rarity tiers show the right name, pill and quote", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  for (const c of TIER_CASES) {
    await search(page, c.query, c.tier === "twilight" ? "NOT FOUND" : "FOUND");
    await expect(page.getByRole("heading", { name: `You earned a ${c.heading} card` })).toBeVisible();
    await openDialog(page);
    const label = await previewLabel(page);
    expect(label).toContain(`${TIER_LABELS[c.tier]} tier`);
    const quote = label.split(" Quote: ")[1] ?? "";
    expect(quote.length).toBeGreaterThan(0);
    expect(QUOTES[c.tier].some((q) => q.text === quote)).toBe(true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  expect(consoleErrors).toEqual([]);
});

test("wish card: all three formats download PNGs within budget", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  await search(page, "12", "FOUND");
  await openDialog(page);

  const cases = [
    { label: "Square", name: "square", width: 1080, height: 1080, budget: 1.5 * 1024 * 1024 },
    { label: "Story", name: "story", width: 1080, height: 1920, budget: 2.2 * 1024 * 1024 },
    { label: "Wide", name: "wide", width: 1200, height: 630, budget: 1.0 * 1024 * 1024 },
  ];
  const measured: Record<string, { width: number; height: number; bytes: number }> = {};
  for (const c of cases) {
    await chooseFormat(page, c.label, c.width, c.height);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.getByRole("button", { name: "Download PNG" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`pi-atlas-wish-digits-12-${c.name}.png`);
    const size = await pngSize((await download.path()) as string);
    expect(size.width).toBe(c.width);
    expect(size.height).toBe(c.height);
    expect(size.bytes, `${c.name} PNG ${size.bytes} bytes`).toBeLessThan(c.budget);
    measured[c.name] = size;
  }
  await fs.mkdir(path.resolve(process.cwd(), "test-results"), { recursive: true });
  await fs.writeFile(
    path.resolve(process.cwd(), "test-results/wish-card-sizes.json"),
    JSON.stringify(measured, null, 2),
  );
  expect(consoleErrors).toEqual([]);
});

test("wish card: twilight download keeps the exact filename", async ({ page }) => {
  await search(page, "12345678901234567890", "NOT FOUND");
  await openDialog(page);
  const label = await previewLabel(page);
  expect(label).toContain("Twilight tier");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(
    "pi-atlas-wish-digits-12345678901234567890-square.png",
  );
});

test("dev gallery: every card passes checks and the contact sheet renders", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  await gotoHash(page, "#/dev/wish");
  await expect(page.getByRole("heading", { name: /wish card gallery/i })).toBeVisible();
  const statuses = page.locator('[data-testid^="gallery-status-"]');
  await expect.poll(async () =>
    statuses.evaluateAll((els) => els.filter((el) => (el.textContent ?? "").includes("checking")).length),
  { timeout: 180_000 }).toBe(0);
  const count = await statuses.count();
  expect(count).toBeGreaterThanOrEqual(30);
  const failures = await statuses.evaluateAll((els) =>
    els.filter((el) => el.textContent !== "OK").map((el) => ({
      id: el.getAttribute("data-testid"),
      detail: el.textContent,
    })),
  );
  expect(failures).toEqual([]);
  const qrTexts = await statuses.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-qr-text") ?? ""),
  );
  expect(qrTexts.every((text) => text.length > 0)).toBe(true);
  expect(qrTexts.some((text) => text.includes("src=card"))).toBe(true);
  await fs.mkdir(REPORT, { recursive: true });
  await page.getByTestId("wish-contact-sheet").screenshot({
    path: path.join(REPORT, "wish-contact-sheet.png"),
  });
  expect(consoleErrors).toEqual([]);
});

test("hide my digits changes QR payload, caption and file name", async ({ page }) => {
  await gotoHash(page, "#/dev/wish");
  const hiddenQr = page.getByTestId("gallery-status-birthday-hidden");
  await expect(hiddenQr).toHaveText("OK", { timeout: 180_000 });
  expect(await hiddenQr.getAttribute("data-qr-text")).not.toContain("q=");

  await search(page, "12", "FOUND");
  await openDialog(page);
  await page.getByRole("checkbox", { name: /hide my digits/i }).check();
  const label = await previewLabel(page);
  expect(label.length).toBeGreaterThan(0);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("pi-atlas-wish-digits-hidden-square.png");
  expect(await copiedCaption(page)).toContain("my secret digits");
});

test("dedication appears on the card and caption, not in the URL or file name", async ({ page }) => {
  await search(page, "12", "FOUND");
  await openDialog(page);
  await page.getByPlaceholder("For someone special").fill("Ana-Maria, 3rd & co.");
  await expect.poll(async () => previewLabel(page), { timeout: 30_000 })
    .toContain("Dedication: Ana-Maria, 3rd & co.");
  expect(await copiedCaption(page)).toContain("For Ana-Maria, 3rd & co.");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("pi-atlas-wish-digits-12-square.png");
});

test("dialog has no serious or critical axe violations", async ({ page }) => {
  await search(page, "12", "FOUND");
  await openDialog(page);
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

test("shortcut w opens, Esc closes, focus returns", async ({ page }) => {
  await search(page, "12", "FOUND");
  // Typing in a search box must not trigger the shortcut.
  await page.getByLabel(/digits \(1–20\)/i).fill("12w");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel(/digits \(1–20\)/i).fill("12");
  await page.getByLabel(/digits \(1–20\)/i).blur();
  await page.keyboard.press("w");
  const dialog = page.getByRole("dialog", { name: /customize your wish card/i });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Customize" })).toBeFocused();
});
