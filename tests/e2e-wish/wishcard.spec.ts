/**
 * Wish-card E2E against the dev server (VITE_E2E=1), covering all three
 * formats, not-found copy, QR decoding in the gallery, privacy mode,
 * accessibility, and the `w` / Esc shortcut pair.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const AXE = path.resolve(process.cwd(), "node_modules/axe-core/axe.min.js");
const WISH = 'section[aria-label="Your wish card"]';

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

async function openDialog(page: Page) {
  await page.getByRole("button", { name: "Customize" }).click();
  await expect(page.getByRole("dialog", { name: /customize your wish card/i })).toBeVisible();
}

async function chooseFormat(page: Page, label: string, width: number, height: number) {
  await page.locator("label.chip").filter({ hasText: label }).first().click();
  await expect.poll(async () =>
    page.locator('[role="dialog"] canvas').first().evaluate((el) => ({
      width: (el as HTMLCanvasElement).width,
      height: (el as HTMLCanvasElement).height,
    })), { timeout: 30_000 }).toEqual({ width, height });
}

test("wish card: all three formats download the right PNG", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  await page.goto("/#/explore/digits?q=12");
  await expect(page.getByText("FOUND", { exact: true })).toBeVisible({ timeout: 60_000 });
  await waitForCard(page);
  await openDialog(page);

  const cases = [
    { label: "Square", name: "square", width: 1080, height: 1080 },
    { label: "Story", name: "story", width: 1080, height: 1920 },
    { label: "Wide", name: "wide", width: 1200, height: 630 },
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
    expect(size.bytes).toBeLessThan(600 * 1024);
    measured[c.name] = size;
  }
  await fs.writeFile(
    path.resolve(process.cwd(), "test-results/wish-card-sizes.json"),
    JSON.stringify(measured, null, 2),
  );
  expect(consoleErrors).toEqual([]);
});

test("wish card: not-found search shows gentle copy and downloads", async ({ page }) => {
  await page.goto("/#/explore/digits?q=12345678901234567890");
  await expect(page.getByText("NOT FOUND", { exact: true })).toBeVisible({ timeout: 60_000 });
  await waitForCard(page);
  await openDialog(page);
  await expect(page.getByRole("dialog")).toContainText(/Hiding deeper|Not in these|hasn’t met it|Too rare|Better luck/i);
  await expect(page.getByRole("dialog")).toContainText(/Expected around digit/i);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("pi-atlas-wish-digits-12345678901234567890-square.png");
});

test("dev gallery: every card QR decodes locally", async ({ page }) => {
  await page.goto("/#/dev/wish");
  await expect(page.getByRole("heading", { name: /wish card gallery/i })).toBeVisible();
  await expect.poll(async () =>
    page.locator('[data-testid^="qr-status-"]').evaluateAll((els) =>
      els.filter((el) => el.textContent !== "QR OK").map((el) => el.getAttribute("data-testid")),
    ), { timeout: 90_000 }).toEqual([]);
  const statuses = await page.locator('[data-testid^="qr-status-"]').count();
  expect(statuses).toBeGreaterThanOrEqual(24);
});

test("hide my digits changes QR payload and file name", async ({ page }) => {
  await page.goto("/#/dev/wish");
  const hiddenQr = page.getByTestId("qr-status-digits-hidden");
  await expect(hiddenQr).toHaveText("QR OK", { timeout: 90_000 });
  expect(await hiddenQr.getAttribute("data-qr-text")).not.toContain("q=");

  await page.goto("/#/explore/digits?q=12");
  await expect(page.getByText("FOUND", { exact: true })).toBeVisible({ timeout: 60_000 });
  await waitForCard(page);
  await openDialog(page);
  await page.getByRole("checkbox", { name: /hide my digits/i }).check();
  await expect.poll(async () =>
    page.locator('[role="dialog"] canvas').first().evaluate((el) => (el as HTMLCanvasElement).width),
  ).toBe(1080);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("pi-atlas-wish-digits-hidden-square.png");
});

test("dialog has no serious or critical axe violations", async ({ page }) => {
  await page.goto("/#/explore/digits?q=12");
  await expect(page.getByText("FOUND", { exact: true })).toBeVisible({ timeout: 60_000 });
  await waitForCard(page);
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
  await page.goto("/#/explore/digits?q=12");
  await expect(page.getByText("FOUND", { exact: true })).toBeVisible({ timeout: 60_000 });
  await waitForCard(page);
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
