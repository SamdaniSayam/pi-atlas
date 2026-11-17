/** Key mobile screenshots for the responsive deliverable (docs/screenshots). */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = new URL("../docs/screenshots", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const W = Number(process.env.SHOT_W ?? 390);
const H = Number(process.env.SHOT_H ?? 844);
const tag = process.env.SHOT_TAG ?? `m${W}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });

async function settle(ms = 400) { await page.waitForTimeout(ms); }

// 1. Home
await page.goto("http://localhost:4174/");
await page.waitForFunction(() => document.querySelector("h1") !== null);
await settle();
await page.screenshot({ path: `${OUT}/${tag}-home.png`, fullPage: true });

// 2. Digits explorer with a result
await page.goto("http://localhost:4174/#/explore/digits?q=12");
await page.getByText("FOUND", { exact: true }).waitFor({ timeout: 60_000 });
await settle();
await page.screenshot({ path: `${OUT}/${tag}-digits.png`, fullPage: true });

// 3. Dates explorer with a result
await page.goto("http://localhost:4174/#/explore/dates");
await page.getByLabel(/pick a date/i).fill("2000-01-01");
await page.getByRole("button", { name: /search six formats/i }).click();
await page.getByText(/Format comparison/i).waitFor({ timeout: 20_000 });
await settle();
await page.screenshot({ path: `${OUT}/${tag}-dates.png`, fullPage: true });

// 4. Colours explorer
await page.goto("http://localhost:4174/#/explore/colors");
await page.waitForFunction(() => document.querySelector("canvas") !== null);
await settle();
await page.screenshot({ path: `${OUT}/${tag}-colors.png`, fullPage: true });

// 5. Letters explorer with a result
await page.goto("http://localhost:4174/#/explore/letters");
await page.getByLabel(/word \(1–12 letters/i).fill("PI");
await page.getByRole("button", { name: /search both frames/i }).click();
await page.getByText(/Total matches \(both frames\)/i).waitFor({ timeout: 20_000 });
await settle();
await page.screenshot({ path: `${OUT}/${tag}-letters.png`, fullPage: true });

// 6. Patterns sheet (bottom nav)
await page.goto("http://localhost:4174/");
await page.waitForFunction(() => document.querySelector("input") !== null);
await page.getByRole("button", { name: "Patterns" }).click();
await page.getByRole("dialog").waitFor();
await settle();
await page.screenshot({ path: `${OUT}/${tag}-sheet-patterns.png` });
await page.keyboard.press("Escape");

// 7. More sheet
await page.getByRole("button", { name: "More" }).click();
await page.getByRole("dialog").waitFor();
await settle();
await page.screenshot({ path: `${OUT}/${tag}-sheet-more.png` });
await page.keyboard.press("Escape");

// 8. Settings sheet (header gear)
await page.getByRole("button", { name: "Open settings" }).click();
await page.getByRole("dialog").waitFor();
await settle();
await page.screenshot({ path: `${OUT}/${tag}-settings.png` });

// 9. Probability Lab
await page.goto("http://localhost:4174/#/probability");
await page.waitForFunction(() => document.querySelector("h1") !== null);
await settle();
await page.screenshot({ path: `${OUT}/${tag}-probability.png`, fullPage: true });

// 10. History screen
await page.goto("http://localhost:4174/#/history");
await page.waitForFunction(() => document.querySelector("h1") !== null);
await settle();
await page.screenshot({ path: `${OUT}/${tag}-history.png`, fullPage: true });

await browser.close();
console.log(`wrote ${OUT}/${tag}-*.png @ ${W}x${H}`);
