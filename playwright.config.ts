import { defineConfig, devices } from "@playwright/test";

// Ports, dataset and server binary are overridable so local verification can
// run alongside the live demo (preview on 4174 + 1B service on 7780) without
// touching either. CI uses the same defaults.
const previewPort = Number(process.env.PI_ATLAS_E2E_PREVIEW_PORT ?? 4174);
const apiPort = Number(process.env.PI_ATLAS_E2E_API_PORT ?? 7787);
const dataDir =
  process.env.PI_ATLAS_E2E_DATA ?? "/home/megalith/pi-atlas-build/data-2m";
const serverBin =
  process.env.PI_ATLAS_E2E_SERVER_BIN ?? "service/target/release/pi-server";

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
    {
      command:
        `PI_ATLAS_DATA=${dataDir} PI_ATLAS_ADDR=127.0.0.1:${apiPort} ${serverBin}`,
      port: apiPort,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
