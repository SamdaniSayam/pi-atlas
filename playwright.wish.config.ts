import { defineConfig, devices } from "@playwright/test";

// The wish-card gallery is compiled only for dev/E2E. This config runs the
// wish-card suite against Vite's dev server with VITE_E2E=1 so #/dev/wish
// exists; the normal production-preview suite is unchanged.
const devPort = Number(process.env.PI_ATLAS_E2E_DEV_PORT ?? 4175);

export default defineConfig({
  testDir: "./tests/e2e-wish",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://localhost:${devPort}`,
    trace: "on-first-retry",
    acceptDownloads: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `VITE_E2E=1 npx vite --port ${devPort} --strictPort`,
      port: devPort,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
