import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site from https://<user>.github.io/<repo>/, so the
  // production build must use relative asset URLs. Override when hosting at a
  // domain root, e.g. VITE_BASE_PATH=/ in CI. Local dev is unaffected.
  base: process.env.VITE_BASE_PATH ?? "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 700,
  },
  // Local development against the Rust search service (D17).
  // Override the proxy target with PI_ATLAS_API to point at another dataset
  // (e.g. PI_ATLAS_API=http://127.0.0.1:7780 npx vite preview --port 4175).
  server: {
    proxy: {
      "/api": process.env.PI_ATLAS_API ?? "http://127.0.0.1:7787",
    },
  },
  preview: {
    proxy: {
      "/api": process.env.PI_ATLAS_API ?? "http://127.0.0.1:7787",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
  },
} as never);
