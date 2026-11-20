import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANONICAL_SITE_URL,
  absoluteSocialImage,
  normalizeSiteRoot,
} from "../../src/lib/socialMetadata";

describe("build-time social image URLs", () => {
  it("falls back to the canonical HTTPS root when unset", () => {
    expect(normalizeSiteRoot(undefined)).toBe(CANONICAL_SITE_URL);
    expect(absoluteSocialImage(undefined)).toBe(
      "https://samdanisayam.github.io/pi-atlas/og.png",
    );
  });

  it("resolves against a custom root with or without a trailing slash", () => {
    expect(absoluteSocialImage("https://example.com/pi-atlas")).toBe(
      "https://example.com/pi-atlas/og.png",
    );
    expect(absoluteSocialImage("https://example.com/pi-atlas/")).toBe(
      "https://example.com/pi-atlas/og.png",
    );
  });

  it("upgrades non-HTTPS roots and ignores malformed ones", () => {
    expect(absoluteSocialImage("http://example.com")).toBe("https://example.com/og.png");
    expect(absoluteSocialImage("not a url")).toBe(
      "https://samdanisayam.github.io/pi-atlas/og.png",
    );
  });
});

describe("Open Graph document metadata", () => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

  it("declares type, canonical URL and image dimensions", () => {
    for (const tag of [
      'property="og:type" content="website"',
      'property="og:url" content="https://samdanisayam.github.io/pi-atlas/"',
      'property="og:image:width" content="1200"',
      'property="og:image:height" content="630"',
    ]) {
      expect(html).toContain(tag);
    }
  });
});
