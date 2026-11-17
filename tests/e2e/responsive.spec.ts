/**
 * Responsive / mobile-first E2E (§38).
 *
 * Covers the master responsive requirements with measurements, not claims:
 *  - no horizontal overflow at any supported width (280…1920), portrait + landscape
 *  - bottom navigation visible below md (768px) and clears page content; hidden md+
 *  - Patterns / More sheets: open, labelled options, Escape + close button, focus inside
 *  - key pages render at the smallest supported width (320px) with no console errors
 *
 * Not covered here (no tooling in headless Chromium): virtual-keyboard occlusion,
 * real-device safe-area insets, foldable posture changes. Reported as not tested.
 */
import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const WIDTHS = [280, 320, 360, 375, 390, 414, 430, 480, 600, 768, 1024, 1280, 1440, 1920];

const portrait = (w: number) => ({ width: w, height: w <= 480 ? w * 2 : 1024 });
const landscape = (w: number) => ({ width: w, height: Math.max(Math.min(Math.round(w * 0.6), 900), 160) });

async function expectNoOverflow(page: Page, label: string): Promise<void> {
  const { doc, body } = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(doc, `${label}: document must not overflow horizontally`).toBeLessThanOrEqual(0);
  expect(body, `${label}: body must not overflow horizontally`).toBeLessThanOrEqual(0);
}

async function gotoSettled(page: Page, hash: string): Promise<void> {
  await page.goto(hash);
  // Wait until the explorer/page has rendered its first interactive control.
  await page.waitForFunction(() => document.querySelector("input, canvas, table, h1") !== null, undefined, { timeout: 15_000 });
  // Let the layout settle (fonts, ResizeObserver-driven canvas sizing) before measuring.
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
  await page.waitForTimeout(350);
}

for (const w of WIDTHS) {
  for (const [orient, vp] of [["portrait", portrait(w)], ["landscape", landscape(w)]] as const) {
    test(`no horizontal overflow @${w}px ${orient} (Home + Digits explorer)`, async ({ page }) => {
      await page.setViewportSize(vp);
      await gotoSettled(page, "/");
      await expectNoOverflow(page, `Home @${w} ${orient}`);
      await gotoSettled(page, "/#/explore/digits");
      await expectNoOverflow(page, `Digits @${w} ${orient}`);
    });
  }
}

test("bottom navigation visible below 768px and clears content; hidden at md+", async ({ page }) => {
  // Mobile: nav visible, main bottom padding clears the 56px nav bar + safe area.
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoSettled(page, "/");
  const nav = page.getByRole("navigation", { name: /explorer sections/i });
  await expect(nav).toBeVisible();
  const padBottom = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.getElementById("main")!).paddingBottom),
  );
  expect(padBottom, "main must reserve space for the fixed bottom nav").toBeGreaterThanOrEqual(56);

  // Desktop: nav hidden, header nav visible.
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoSettled(page, "/");
  await expect(nav).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});

test("Patterns and More sheets: open, labelled options, Escape + close button, focus inside", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await gotoSettled(page, "/");

  // Patterns sheet
  await page.getByRole("button", { name: "Patterns" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: /colour patterns/i })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /shape patterns/i })).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('[role="dialog"]')!.contains(document.activeElement))).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // More sheet
  await page.getByRole("button", { name: "More" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: /probability lab/i })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /^history/i })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /^about/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^settings/i })).toBeVisible();
  // Close via the labelled close button
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog).toBeHidden();

  // Sheet option deep-links: Colours from the Patterns sheet
  await page.getByRole("button", { name: "Patterns" }).click();
  await page.getByRole("link", { name: /colour patterns/i }).click();
  await expect(page).toHaveURL(/explore\/colors/);
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("key pages render at 320px with no overflow and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });

  await page.setViewportSize({ width: 320, height: 568 });
  const routes = [
    "/",
    "/#/explore/digits",
    "/#/explore/dates",
    "/#/explore/letters",
    "/#/explore/colors",
    "/#/explore/shapes",
    "/#/probability",
    "/#/about",
    "/#/history",
  ];
  for (const r of routes) {
    await gotoSettled(page, r);
    await expectNoOverflow(page, r);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  expect(errors, `unexpected console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("digit explorer controls are touch-sized at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await gotoSettled(page, "/#/explore/digits?q=12");
  await expect(page.getByText("FOUND", { exact: true })).toBeVisible({ timeout: 60_000 });
  const btn = page.getByRole("button", { name: "Next occurrence" });
  const box = await btn.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height, "occurrence nav buttons must be >= 44px tall").toBeGreaterThanOrEqual(44);
  // Search input: 16px font minimum to avoid iOS zoom
  const input = page.getByLabel(/digits \(1–20\)/i);
  const fontSize = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize, "search input must be >= 16px to avoid iOS zoom").toBeGreaterThanOrEqual(16);
});
