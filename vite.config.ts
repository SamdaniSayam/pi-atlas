import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { absoluteSocialImage, normalizeSiteRoot } from "./src/lib/socialMetadata";

/**
 * Social crawlers do not resolve relative og:image URLs consistently. Rewrite
 * the two image tags to absolute HTTPS URLs at build time, with a safe fallback
 * when VITE_SITE_URL is unset in local/CI builds.
 */
function absoluteSocialImages(): Plugin {
  const siteRoot = normalizeSiteRoot(process.env.VITE_SITE_URL);
  const imageUrl = absoluteSocialImage(siteRoot);
  const replaceContent = (html: string, attribute: string, name: string, value: string): string => {
    const pattern = new RegExp(`(<meta\\s+${attribute}="${name}"\\s+content=")[^"]*(")`);
    return html.replace(pattern, `$1${value}$2`);
  };
  return {
    name: "absolute-social-images",
    transformIndexHtml(html) {
      return replaceContent(
        replaceContent(
          replaceContent(html, "property", "og:image", imageUrl),
          "name",
          "twitter:image",
          imageUrl,
        ),
        "property",
        "og:url",
        siteRoot,
      );
    },
  };
}

/**
 * Static-hosting CSP. GitHub Pages cannot send response headers, so the policy
 * is injected at build time (dev keeps Vite's inline React-refresh preamble).
 * `wasm-unsafe-eval` is required to instantiate the search engine.
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: policy },
          injectTo: "head-prepend" as const,
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), absoluteSocialImages(), contentSecurityPolicy()],
  // GitHub Pages serves the site from https://<user>.github.io/<repo>/, so the
  // production build must use relative asset URLs. Override when hosting at a
  // domain root, e.g. VITE_BASE_PATH=/ in CI. Local dev is unaffected.
  base: process.env.VITE_BASE_PATH ?? "./",
  // The dev gallery route is compiled away in production. VITE_E2E lets a
  // dedicated E2E build enable it when needed.
  define: { "import.meta.env.VITE_E2E": JSON.stringify(process.env.VITE_E2E ?? "") },
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
});
