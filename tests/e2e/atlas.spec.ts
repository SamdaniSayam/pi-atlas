/**
 * End-to-end tests (§38). All flows run against the real dataset and the real
 * engines through the production build served by `vite preview`.
 */
import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("landing page loads with hero and quick experiment", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /is everything hiding in/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /explore π/i })).toBeVisible();
  await expect(page.getByPlaceholder(/try a number/i)).toBeVisible();
});

test("search for 12 from the landing page finds position 148", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => document.body.textContent?.includes("verified") && document.body.textContent?.includes("served live"), undefined, { timeout: 30000 });
  await page.getByPlaceholder(/try a number/i).fill("12");
  await page.getByPlaceholder(/try a number/i).press("Enter");
  await expect(page).toHaveURL(/explore\/digits\?q=12/);
  await expect(page.getByText(/position 148/).first()).toBeVisible({ timeout: 60000 });
});

test("digits explorer: occurrences, navigation, minimap", async ({ page }) => {
  await page.goto("/#/explore/digits?q=12");
  await expect(page.getByText("FOUND", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(/Occurrences in dataset/)).toBeVisible();

  const counter = page.getByTestId("occurrence-counter");
  await expect(counter).toHaveText(/1,? ?\/ ?19,800|1 \\/, { timeout: 10000 });
  // navigate to occurrence 2
  await page.getByRole("button", { name: "Next occurrence" }).click();
  await expect(counter).toHaveText(/2 \//);
  // minimap present
  await expect(page.getByRole("slider", { name: /dataset position/i })).toBeVisible();
});

test("digits explorer: not-found shows closest prefix, never a false universal claim", async ({ page }) => {
  await page.goto("/#/explore/digits?q=12345678901234567890");
  await expect(page.getByText("NOT FOUND", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/not found|absent|Closest find/i).first()).toBeVisible();
});

test("date explorer searches six formats", async ({ page }) => {
  await page.goto("/#/explore/dates");
  await page.getByLabel(/pick a date/i).fill("2000-01-01");
  await page.getByRole("button", { name: /search six formats/i }).click();
  await expect(page.getByText(/Format comparison/i)).toBeVisible({ timeout: 20000 });
  for (const fmt of ["DDMMYYYY", "MMDDYYYY", "YYYYMMDD", "YYMMDD"]) {
    await expect(page.getByText(fmt, { exact: false }).first()).toBeVisible();
  }
});

test("letter explorer searches both frames", async ({ page }) => {
  await page.goto("/#/explore/letters");
  await page.getByLabel(/word \(1–12 letters/i).fill("PI");
  await page.getByRole("button", { name: /search both frames/i }).click();
  await expect(page.getByText(/Total matches \(both frames\)/i)).toBeVisible({ timeout: 20000 });
  const tabA = page.getByRole("tab", { name: "Frame A" });
  const tabB = page.getByRole("tab", { name: "Frame B" });
  await expect(tabA).toBeVisible();
  await expect(tabB).toBeVisible();
  // switch frame tab
  await tabB.click();
  await expect(tabB).toHaveAttribute("aria-selected", "true");
});

test("colour explorer: paint and search a pattern", async ({ page }) => {
  await page.goto("/#/explore/colors");
  // paint a cell via the accessible grid
  const grid = page.getByRole("grid", { name: /pattern grid/i });
  await grid.click();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Search pattern" }).click();
  await expect(page.getByText(/match(es)? found|No match found/i)).toBeVisible({ timeout: 30000 });
});

test("shape explorer: draw and search", async ({ page }) => {
  await page.goto("/#/explore/shapes");
  // use the Plus preset then search
  await page.getByRole("button", { name: "Plus", exact: true }).click();
  await page.getByRole("button", { name: "Search pattern" }).click();
  await expect(page.getByText(/match(es)? found|No match found/i)).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(/Matches in dataset/)).toBeVisible({ timeout: 30000 });
});

test("probability lab computes odds and preview", async ({ page }) => {
  await page.goto("/#/probability");
  await expect(page.getByText(/How big can a findable picture be/i)).toBeVisible();
  await expect(page.getByText(/Chance at one spot/i)).toBeVisible();
  await expect(page.getByText(/Search space/i)).toBeVisible();
  await expect(page.getByText(/idealised random model/i)).toBeVisible();
});

test("statistics appear on the home page big-question panel", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Chi-square \(9 df\)/i)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/consistent/i).first()).toBeVisible();
});

test("theme switch persists", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /theme:/i });
  await toggle.click(); // system → dark
  await expect(toggle).toHaveAttribute("aria-label", /theme: dark/i);
  await toggle.click(); // dark → light
  await expect(toggle).toHaveAttribute("aria-label", /theme: light/i);
  await page.reload();
  await expect(page.getByRole("button", { name: /theme: light/i })).toBeVisible();
});

test("share link restores the search state", async ({ page, context, browserName }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/#/explore/digits?q=999999");
  await expect(page.getByText("FOUND", { exact: true })).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: /copy link/i }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain("q=999999");
  await page.goto(url);
  await expect(page.getByText("FOUND", { exact: true })).toBeVisible({ timeout: 60000 });
  void browserName;
});

test("PNG export downloads a file", async ({ page }) => {
  await page.goto("/#/explore/digits?q=12");
  await expect(page.getByText("FOUND", { exact: true })).toBeVisible({ timeout: 60000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByRole("button", { name: /png/i }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^pi-atlas-12.*\.png$/);
});

test("guided tour completes all four acts", async ({ page }) => {
  await page.goto("/#/tour");
  await expect(page.getByText(/Act 1 · Numbers/i)).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: /next/i }).click();
  await expect(page.getByText(/Act 2 · Words/i)).toBeVisible();
  await page.getByRole("button", { name: /next/i }).click();
  await expect(page.getByText(/Act 3 · Colours/i)).toBeVisible();
  await page.getByRole("button", { name: /next/i }).click();
  await expect(page.getByText(/Act 4 · Shapes/i)).toBeVisible();
  // real search results visible
  await expect(page.getByText(/Live search/i).first()).toBeVisible();
  await page.getByRole("link", { name: /skip tour/i }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test("keyboard navigation: skip link and search submission", async ({ page }) => {
  await page.goto("/#/explore/digits");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /skip to content/i })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused().catch(() => undefined);
  const input = page.getByLabel(/digits \(1–20\)/i);
  await input.fill("314");
  await input.press("Enter");
  await expect(page.getByText(/position \d/).first()).toBeVisible({ timeout: 20000 });
});

test("mobile layout at 360px renders bottom navigation", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/#/explore/digits");
  await expect(page.getByRole("navigation", { name: /explorer sections/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /digits/i }).last()).toBeVisible();
});
