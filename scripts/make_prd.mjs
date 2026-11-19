/**
 * Render PRD.html into PRD.pdf with the already-installed Playwright Chromium.
 * Purely local: no network access, no fonts downloaded, no new dependencies.
 *
 * Run heavy commands under the machine's cap, e.g.
 *   systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 \
 *     npm run make:prd
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "PRD.html");
const output = path.join(root, "PRD.pdf");

await fs.access(source);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(source).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts?.ready);

  await page.pdf({
    path: output,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#667085;
                  width:100%;padding:0 16mm;display:flex;justify-content:space-between;
                  box-sizing:border-box;">
        <span>π Atlas — Product Requirements Document</span>
        <span>Build · Architecture · Features · Verification</span>
      </div>`,
    footerTemplate: `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#667085;
                  width:100%;padding:0 16mm;display:flex;justify-content:space-between;
                  box-sizing:border-box;">
        <span>On-device · Static · No backend</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`,
    margin: { top: "18mm", bottom: "18mm", left: "15mm", right: "15mm" },
  });
} finally {
  await browser.close();
}

const stat = await fs.stat(output);
console.log(`PRD.pdf written: ${output} (${stat.size.toLocaleString("en-US")} bytes)`);
