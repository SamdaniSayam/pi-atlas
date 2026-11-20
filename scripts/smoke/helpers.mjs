/**
 * Shared helpers for the pre-deploy smoke test. Uses the project's Playwright
 * install directly so checks can stay sequential and the report can be ours.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

export const REPORT_DIR = path.resolve(process.cwd(), "smoke-report");
export const SCREEN_DIR = path.join(REPORT_DIR, "screens");

function cleanDetail(text) {
  return String(text ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function matchesAllowed(text, allow) {
  return allow.some((pattern) => {
    try {
      return new RegExp(pattern).test(text);
    } catch {
      return text.includes(pattern);
    }
  });
}

export class SmokeHarness {
  constructor({ baseURL, live, actionTimeout = 60_000, skip = new Set(), allow = [] }) {
    this.baseURL = baseURL;
    this.live = live;
    this.actionTimeout = actionTimeout;
    this.skip = skip;
    this.allow = allow;
    this.results = [];
    this.consoleErrors = [];
    this.failedRequests = [];
    this.fontResponses = [];
    this.manifestResponse = null;
    this.bytes = 0;
    this.contexts = [];
    this.currentPage = null;
    this.browser = null;
    this.startedAt = new Date();
  }

  async launch() {
    // Large dataset chunks can outgrow the container's /dev/shm; spill to disk
    // so a 1B scan does not crash the renderer for an unrelated shm limit.
    this.browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  }

  async close() {
    await this.browser?.close();
  }

  async newContext(options = {}) {
    const ctx = await this.browser.newContext(options);
    // Keep every fresh context (including banner/mobile ones that re-download
    // the full dataset) on the same data-dependent timeout budget.
    ctx.setDefaultTimeout(this.actionTimeout);
    ctx.setDefaultNavigationTimeout(this.actionTimeout);
    ctx.on("requestfailed", (request) => {
      const reason = request.failure()?.errorText ?? "failed";
      // The smoke test deliberately reloads pages between hash routes, which
      // cancels any in-flight asset request. Those aborts are expected and are
      // not application failures; everything else still counts.
      if (reason === "net::ERR_ABORTED") return;
      const text = `${request.url()} ${reason}`;
      if (!matchesAllowed(text, this.allow)) this.failedRequests.push(text);
    });
    ctx.on("response", (response) => {
      const url = response.url();
      if (response.status() >= 400) {
        const text = `${response.status()} ${url}`;
        if (!matchesAllowed(text, this.allow)) this.failedRequests.push(text);
      }
      if (/web-manifest\.json($|\?)/.test(url) && !this.manifestResponse) this.manifestResponse = response;
      if (/\.woff2($|\?)/.test(url)) {
        this.fontResponses.push({ url, status: response.status(), type: response.headers()["content-type"] ?? "" });
      }
    });
    this.contexts.push(ctx);
    return ctx;
  }

  async newPage(ctx) {
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") this.consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => this.consoleErrors.push(err.message));
    try {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      cdp.on("Network.loadingFinished", (event) => {
        this.bytes += Number(event.encodedDataLength ?? 0);
      });
    } catch {
      // CDP byte counting is best-effort; the check is WARN-only.
    }
    this.currentPage = page;
    return page;
  }

  async screenshot(name) {
    try {
      await fs.mkdir(SCREEN_DIR, { recursive: true });
      await this.currentPage?.screenshot({ path: path.join(SCREEN_DIR, `${name}.png`), fullPage: true });
    } catch {
      // A screenshot is diagnostic only; never mask the original failure.
    }
  }

  record(name, status, required, ms, detail) {
    this.results.push({ name, status, required, ms, detail: cleanDetail(detail) });
  }

  async check(name, fn, { required = true, usePage = null } = {}) {
    if (this.skip.has(name)) {
      this.record(name, "SKIP", required, 0, "skipped via SMOKE_SKIP");
      return null;
    }
    if (usePage) this.currentPage = usePage;
    const started = Date.now();
    try {
      const detail = await fn();
      this.record(name, "PASS", required, Date.now() - started, detail || "ok");
      return detail;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.record(name, "FAIL", required, Date.now() - started, message);
      await this.screenshot(name);
      return null;
    }
  }

  soft(name, over, detail) {
    this.record(name, over ? "WARN" : "PASS", false, 0, detail);
  }

  failedRequired() {
    return this.results.filter((r) => r.required && r.status === "FAIL").length;
  }

  summary() {
    const lines = ["| Check | Status | Time | Detail |", "| --- | --- | ---: | --- |"];
    for (const r of this.results) {
      lines.push(`| ${r.name} | ${r.status} | ${r.ms} ms | ${r.detail} |`);
    }
    return lines.join("\n");
  }

  async writeReports(target) {
    await fs.mkdir(REPORT_DIR, { recursive: true });
    const failed = this.failedRequired();
    const result = failed ? `FAIL (${failed} required checks failed)` : "PASS";
    const gitCommit = (() => {
      try {
        return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
      } catch {
        return "unknown";
      }
    })();
    const payload = {
      date: this.startedAt.toISOString(),
      targetUrl: target,
      gitCommit,
      live: this.live,
      checks: this.results,
      consoleErrors: this.consoleErrors,
      failedRequests: this.failedRequests,
      bytesTransferred: this.bytes,
      result,
    };
    await fs.writeFile(path.join(REPORT_DIR, "report.json"), `${JSON.stringify(payload, null, 2)}\n`);
    const consoleBlock = this.consoleErrors.length ? this.consoleErrors.map((e) => `- ${cleanDetail(e)}`).join("\n") : "- none";
    const requestsBlock = this.failedRequests.length ? this.failedRequests.map((e) => `- ${cleanDetail(e)}`).join("\n") : "- none";
    const md = [
      `# Smoke report — ${this.startedAt.toISOString()}`,
      "",
      `- Target: ${target}`,
      `- Git commit: ${gitCommit}`,
      `- Mode: ${this.live ? "live (read-only)" : "local preview"}`,
      "",
      this.summary(),
      "",
      "## Console errors",
      "",
      consoleBlock,
      "",
      "## Failed requests",
      "",
      requestsBlock,
      "",
      `Total bytes transferred: ${this.bytes}`,
      "",
      `RESULT: ${result}`,
      "",
    ].join("\n");
    await fs.writeFile(path.join(REPORT_DIR, "report.md"), md);
    return result;
  }
}
