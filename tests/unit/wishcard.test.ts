import { describe, expect, it } from "vitest";
import { buildCaption, stripQueryFromUrl } from "../../src/wishcard/caption";
import { eyebrow, hashString, pickCopy } from "../../src/wishcard/copy";
import { fileNameFor, fitText, slugFor } from "../../src/wishcard/layout";
import { explorerUrl, qrContentFor } from "../../src/wishcard/qr";
import type { WishCardInput } from "../../src/wishcard/types";

function input(patch: Partial<WishCardInput> = {}): WishCardInput {
  return {
    mode: "digits",
    found: true,
    query: "12",
    count: 19800,
    firstPosition: 148,
    expected: 9999,
    expectedDepthLog10: 2,
    datasetSize: 1_000_000_000,
    longestPrefix: null,
    context: null,
    shareUrl: "https://samdanisayam.github.io/pi-atlas/#/explore/digits?q=12",
    hideQuery: false,
    ...patch,
  };
}

describe("wish-card copy", () => {
  it("is deterministic for the same search", () => {
    expect(pickCopy(input())).toEqual(pickCopy(input()));
    expect(pickCopy(input({ query: "314159" }))).toEqual(pickCopy(input({ query: "314159" })));
  });

  it("reaches every headline in both pools", () => {
    const found = new Set<string>();
    const missing = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      found.add(pickCopy(input({ query: String(i) })).headline);
      missing.add(pickCopy(input({ query: String(i), found: false })).headline);
    }
    expect(found.size).toBe(5);
    expect(missing.size).toBe(5);
  });

  it("uses the rarity eyebrows at every count boundary", () => {
    expect(eyebrow(input({ count: 1 }))).toBe("RARE FIND");
    expect(eyebrow(input({ count: 9 }))).toBe("RARE FIND");
    expect(eyebrow(input({ count: 10 }))).toBe("CONGRATULATIONS");
    expect(eyebrow(input({ count: 99 }))).toBe("CONGRATULATIONS");
    expect(eyebrow(input({ count: 100 }))).toBe("NICE FIND");
    expect(eyebrow(input({ count: 0 }))).toBe("RARE FIND");
  });

  it("uses SO CLOSE only for a near-complete prefix of digits or letters", () => {
    const close = { prefix: "12345", position: 42 };
    expect(eyebrow(input({ found: false, longestPrefix: close }))).toBe("SO CLOSE");
    expect(eyebrow(input({ mode: "letters", found: false, longestPrefix: close }))).toBe("SO CLOSE");
    expect(eyebrow(input({ found: false, query: "123456", longestPrefix: { prefix: "12", position: 42 } }))).toBe("NOT THIS TIME");
    expect(eyebrow(input({ mode: "pixels", found: false, longestPrefix: close }))).toBe("NOT THIS TIME");
  });

  it("writes a singular found subline for one occurrence", () => {
    const copy = pickCopy(input({ count: 1, firstPosition: 1_234_567 }));
    expect(copy.subline).toContain("appears once");
    expect(copy.subline).toContain("1,234,567");
  });

  it("writes a depth line for missing searches", () => {
    const copy = pickCopy(input({ found: false, count: 0, expectedDepthLog10: 24 }));
    expect(copy.subline).toContain("10²⁴");
    expect(hashString("abc")).toBe(hashString("abc"));
  });

  it("states the actual scanned dataset size, never a hardcoded 2M", () => {
    expect(pickCopy(input()).subline).toContain("first 1 billion digits of π");
    expect(pickCopy(input({ datasetSize: 2_000_000 })).subline).toContain("first 2 million digits of π");
    expect(buildCaption(input({ found: false, count: 0, datasetSize: 2_000_000 }))).toContain("Not in the first 2 million digits");
  });
});

describe("wish-card caption", () => {
  it("builds found and not-found captions", () => {
    expect(buildCaption(input())).toContain("found it at position 148");
    expect(buildCaption(input({ found: false, count: 0 }))).toContain("Not in the first 1 billion digits");
  });

  it("hides the query in caption and URL when requested", () => {
    const card = input({ hideQuery: true });
    const caption = buildCaption(card);
    expect(caption).toContain("my secret digits");
    expect(caption).not.toContain("q=12");
    expect(caption).toContain("#PiAtlas #pi");
    expect(stripQueryFromUrl("https://x.test/pi/#/explore/digits?q=12&occ=2")).toBe(
      "https://x.test/pi/#/explore/digits?occ=2",
    );
    expect(stripQueryFromUrl("https://x.test/pi/#/explore/digits?q=12")).toBe("https://x.test/pi/#/explore/digits");
  });
});

describe("wish-card QR fallback", () => {
  it("uses the full share URL for normal searches", () => {
    const card = input();
    const content = qrContentFor(card);
    expect(content.text).toBe(card.shareUrl);
    expect(content.shortened).toBe(false);
  });

  it("uses a query-free explorer URL when the QR would be too dense", () => {
    const longQuery = "9".repeat(1500);
    const card = input({ query: longQuery, shareUrl: `https://pi.test/pi-atlas/#/explore/digits?q=${longQuery}` });
    const content = qrContentFor(card);
    expect(content.shortened).toBe(true);
    expect(content.text).not.toContain("q=");
    expect(explorerUrl(card.shareUrl)).toBe("https://pi.test/pi-atlas/#/explore/digits");
  });

  it("removes the query for hidden cards", () => {
    const content = qrContentFor(input({ hideQuery: true }));
    expect(content.text).not.toContain("q=");
  });
});

describe("wish-card layout helpers", () => {
  function measurer(sizeToWidth: (size: number) => number): CanvasRenderingContext2D {
    return {
      font: "600 16px Inter",
      measureText(this: { font: string }) {
        const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 16);
        return { width: sizeToWidth(size) };
      },
    } as unknown as CanvasRenderingContext2D;
  }

  it("fits text without exceeding the width or going below the minimum", () => {
    const ctx = measurer((size) => size * 6);
    const size = fitText(ctx, "long headline", 160, 80, 20);
    expect(size).toBe(26);
    expect(size).toBeGreaterThanOrEqual(20);
    expect(ctx.font).toContain("26px");
  });

  it("returns the minimum size when nothing fits", () => {
    const ctx = measurer((size) => size * 10);
    expect(fitText(ctx, "very long", 100, 80, 20)).toBe(20);
  });

  it("builds slugs and filenames, including the hidden slug", () => {
    expect(slugFor(input({ query: "12" }))).toBe("12");
    expect(slugFor(input({ query: "Hello, World!" }))).toBe("helloworld");
    expect(slugFor(input({ query: "012345678901234567890" }))).toBe("01234567890123456789");
    expect(slugFor(input({ pattern: { rows: 6, cols: 6, cells: [], kind: "shape", exact: true } }))).toBe("r6x6");
    expect(slugFor(input({ hideQuery: true }))).toBe("hidden");
    expect(fileNameFor(input(), "square")).toBe("pi-atlas-wish-digits-12-square.png");
    expect(fileNameFor(input({ hideQuery: true, mode: "letters" }), "wide")).toBe("pi-atlas-wish-letters-hidden-wide.png");
  });
});
