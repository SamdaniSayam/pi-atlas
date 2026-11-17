import { defineConfig, devices } from "@playwright/test";

// Stage 8: E2E runs entirely against the static production build. The Rust
// service is no longer started — the app loads its dataset from same-origin
// static chunks and searches through the in-page WASM Worker.
const previewPort = Number(process.env.PI_ATLAS_E2E_PREVIEW_PORT ?? 4174);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://localhost:${previewPort}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: `npx vite preview --port ${previewPort} --strictPort`,
      port: previewPort,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
