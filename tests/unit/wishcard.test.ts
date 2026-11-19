import { describe, expect, it } from "vitest";
import { describeMagnitude } from "../../src/engine/format";
import { buildCaption, stripQueryFromUrl, stripSrcCard } from "../../src/wishcard/caption";
import {
  HEADLINES, HONESTY_BANNED, QUOTES, SUBLINES,
  editionTag, eyebrow, pickCopy, previewLine, sanitizeDedication,
} from "../../src/wishcard/copy";
import {
  FORMATS, LAYOUTS, cacheKeyFor, fileNameFor, fitText,
  layoutBoxes, qrPlateFor, slugFor,
} from "../../src/wishcard/layout";
import { explorerUrl, qrContentFor } from "../../src/wishcard/qr";
import { CLEAN_THEME, THEMES, contrastRatio } from "../../src/wishcard/themes";
import { TIER_LABELS, TIER_THRESHOLDS, oneIn, tierFor, tierPill } from "../../src/wishcard/tiers";
import { DEFAULT_WISH_OPTIONS } from "../../src/wishcard/types";
import { buildShareUrl } from "../../src/lib/url";
import type { WishCardInput, WishTier } from "../../src/wishcard/types";

function input(patch: Partial<WishCardInput> = {}): WishCardInput {
  const found = patch.found ?? true;
  const expected = patch.expected ?? 9999;
  const tier = patch.tier ?? tierFor({ found, expected });
  return {
    mode: "digits",
    found,
    query: "12",
    count: found ? 19800 : 0,
    firstPosition: found ? 148 : null,
    expected,
    expectedDepthLog10: 2,
    datasetSize: 1_000_000_000,
    datasetWords: "1 billion digits",
    longestPrefix: null,
    context: null,
    shareUrl: "https://samdanisayam.github.io/pi-atlas/#/explore/digits?q=12",
    hideQuery: false,
    tier,
    subject: "number",
    dedication: "",
    style: "collectible",
    ...patch,
  };
}

const TIERS: WishTier[] = ["gold", "silver", "aurora", "twilight"];

describe("wish-card rarity tiers", () => {
  it("uses the exact thresholds", () => {
    expect(TIER_THRESHOLDS).toEqual({ gold: 0.01, silver: 1 });
  });

  it("classifies not-found as twilight at any expected value", () => {
    for (const expected of [0.0000001, 0.5, 1, 9999, Number.NaN]) {
      expect(tierFor({ found: false, expected })).toBe("twilight");
    }
  });

  it("classifies found results by expected count", () => {
    expect(tierFor({ found: true, expected: 0.009 })).toBe("gold");
    expect(tierFor({ found: true, expected: 0.01 })).toBe("silver");
    expect(tierFor({ found: true, expected: 0.5 })).toBe("silver");
    expect(tierFor({ found: true, expected: 0.9999 })).toBe("silver");
    expect(tierFor({ found: true, expected: 1 })).toBe("aurora");
    expect(tierFor({ found: true, expected: 1.0001 })).toBe("aurora");
    expect(tierFor({ found: true, expected: 9999 })).toBe("aurora");
  });

  it("treats invalid expected as 1 and never logs or throws", () => {
    for (const expected of [Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) {
      expect(tierFor({ found: true, expected })).toBe("aurora");
    }
  });

  it("exposes the four result labels and exact pill names", () => {
    expect(TIER_LABELS).toEqual({
      gold: "Legendary", silver: "Rare", aurora: "Lucky", twilight: "Twilight",
    });
    const tierInputs: Record<WishTier, WishCardInput> = {
      gold: input({ expected: 0.001 }),
      silver: input({ expected: 0.1 }),
      aurora: input({ expected: 10 }),
      twilight: input({ found: false, expected: 10 }),
    };
    for (const tier of TIERS) {
      expect(tierPill(tierInputs[tier])).toBe(eyebrow(tierInputs[tier]));
    }
    expect(tierPill(tierInputs.gold)).toBe("LEGENDARY · 1 IN 1,001");
    expect(tierPill(tierInputs.silver)).toBe("RARE · 1 IN 11");
    expect(tierPill(tierInputs.aurora)).toBe("LUCKY FIND");
    expect(tierPill(input({
      found: false, tier: "twilight", longestPrefix: { prefix: "123", position: 42 },
    }))).toBe("UNCHARTED");
    expect(tierPill(input({
      found: false, tier: "twilight", query: "1234", longestPrefix: { prefix: "1", position: 42 },
    }))).toBe("UNCHARTED");
  });
});

describe("wish-card one-in-N odds", () => {
  it("uses at-least-one probability P = 1 - exp(-expected), rounded and described", () => {
    for (const expected of [0.01, 0.009, 0.001, 0.000001, 0.1, 1, 10]) {
      const p = 1 - Math.exp(-expected);
      expect(oneIn(expected)).toBe(describeMagnitude(Math.round(1 / p)));
    }
  });

  it("produces readable magnitudes", () => {
    expect(oneIn(0.000001)).toBe("1 million");
    expect(oneIn(0.001)).toBe("1 thousand");
    expect(oneIn(Number.NaN)).toBe("2");
  });
});

describe("wish-card copy deck", () => {
  it("is deterministic for the same search", () => {
    expect(pickCopy(input())).toEqual(pickCopy(input()));
    const golden = input({ expected: 0.001 });
    expect(pickCopy(golden)).toEqual(pickCopy({ ...golden }));
    expect(pickCopy(input({ query: "314159" }))).toEqual(
      pickCopy(input({ query: "314159" })),
    );
  });

  it("reaches every headline in every tier pool", () => {
    for (const tier of TIERS) {
      const reached = new Set<string>();
      for (let i = 0; i < 600; i += 1) {
        reached.add(pickCopy(input({ tier, query: String(i) })).headline);
      }
      expect(reached.size).toBe(HEADLINES[tier].length);
    }
  });

  it("reaches every subline and quote in every tier pool", () => {
    for (const tier of TIERS) {
      const sublines = new Set<string>();
      const quotes = new Set<string>();
      for (let i = 0; i < 600; i += 1) {
        const copy = pickCopy(input({ tier, query: String(i) }));
        sublines.add(copy.subline);
        quotes.add(copy.quote.text);
      }
      expect(sublines.size).toBe(SUBLINES[tier].length);
      expect(quotes.size).toBe(QUOTES[tier].length);
    }
  });

  it("keeps all copy short enough for the card and free of raw tokens", () => {
    for (const tier of TIERS) {
      for (let i = 0; i < 50; i += 1) {
        const copy = pickCopy(input({ tier, query: `word${i}`, subject: "word" }));
        for (const text of [copy.headline, copy.subline, copy.odds, copy.quote.text, copy.factLine]) {
          expect(text.length).toBeLessThan(220);
          expect(text).not.toMatch(/[{}]/);
        }
        for (const line of [copy.headline, copy.subline, copy.odds, copy.quote.text]) {
          for (const banned of HONESTY_BANNED) {
            expect(line.toLowerCase()).not.toContain(banned);
          }
        }
      }
    }
  });

  it("attributes only the Hilbert quote and only in the twilight pool", () => {
    const attributed = TIERS.flatMap((tier) =>
      QUOTES[tier].filter((quote) => quote.by).map((quote) => ({ tier, text: quote.text, by: quote.by })),
    );
    expect(attributed).toEqual([{
      tier: "twilight",
      text: "We must know. We will know.",
      by: "David Hilbert, 1930",
    }]);
    expect(QUOTES.twilight.some((q) => q.text === "We must know. We will know.")).toBe(true);
  });

  it("prints the exact honesty fine print on every card", () => {
    for (const tier of TIERS) {
      expect(pickCopy(input({ tier })).finePrint).toBe(
        "Odds assume random digits · Statistics, not magic.",
      );
    }
    expect(pickCopy(input()).finePrint).toContain("Statistics, not magic.");
    // "magic" is allowed only in the fine print.
    for (const tier of TIERS) {
      const copy = pickCopy(input({ tier }));
      for (const text of [copy.headline, copy.subline, copy.odds, copy.quote.text]) {
        expect(text.toLowerCase()).not.toContain("magic");
      }
    }
  });

  it("uses no italic font markers in quotes", () => {
    for (const tier of TIERS) {
      for (const quote of QUOTES[tier]) {
        expect(quote.text).not.toMatch(/<i|<\/?em|font-style/i);
      }
    }
  });

  it("states the actual scanned dataset size, never a hardcoded 2M", () => {
    expect(pickCopy(input({ found: false })).factLine).toBe("Absent in the first 1,000,000,000 digits");
    expect(pickCopy(input({ found: false, datasetSize: 2_000_000, datasetWords: "2 million digits" })).factLine)
      .toBe("Absent in the first 2,000,000 digits");
    expect(editionTag(2_000_000)).toBe("EDITION · 2M");
    expect(editionTag(1_000_000_000)).toBe("EDITION · 1B");
    expect(buildCaption(input({ found: false, datasetSize: 2_000_000, datasetWords: "2 million digits" })))
      .toContain("2 million digits");
  });

  it("formats the one-in odds only for gold and silver", () => {
    expect(pickCopy(input({ expected: 0.000001 })).oneIn).toBe("1 million");
    expect(pickCopy(input({ expected: 0.1 })).oneIn).toBe("11");
    expect(pickCopy(input({ expected: 10 })).oneIn).toBe("");
    expect(pickCopy(input({ found: false })).oneIn).toBe("");
    expect(pickCopy(input({ expected: 0.000001 })).odds).toContain("1 in 1 million");
  });

  it("writes a deterministic one-line preview summary", () => {
    const gold = pickCopy(input({ expected: 0.000001 }));
    expect(previewLine(input({ expected: 0.000001 }), gold)).toContain("Legendary card");
    expect(previewLine(input({ expected: 0.000001 }), gold)).toContain("1 in 1 million chance");
    const aurora = pickCopy(input());
    expect(previewLine(input(), aurora)).toContain("Lucky card");
    expect(previewLine(input(), aurora)).toContain("Found");
  });
});

describe("wish-card dedication sanitizer", () => {
  it("keeps Latin letters, accents, digits and the allowed punctuation", () => {
    expect(sanitizeDedication("Ana-Maria, 3rd & co.").value).toBe("Ana-Maria, 3rd & co.");
    expect(sanitizeDedication("Élodie O’Neill").value).toBe("Élodie O’Neill");
    expect(sanitizeDedication("Zoë 123").value).toBe("Zoë 123");
  });

  it("collapses spaces, trims, and caps at 24 characters", () => {
    expect(sanitizeDedication("  A   B  ").value).toBe("A B");
    const long = "A".repeat(40);
    expect(sanitizeDedication(long).value).toBe("A".repeat(24));
    expect(sanitizeDedication(long).removed).toBe(true);
  });

  it("drops emoji and other scripts and reports the removal", () => {
    expect(sanitizeDedication("Hi 🌟").value).toBe("Hi");
    expect(sanitizeDedication("Hi 🌟").removed).toBe(true);
    expect(sanitizeDedication("東京").value).toBe("");
    expect(sanitizeDedication("東京").removed).toBe(true);
    expect(sanitizeDedication("Clean text").removed).toBe(false);
  });
});

describe("wish-card theme contrast", () => {
  it("keeps primary text at 7:1 and muted text at 4.5:1 on every palette", () => {
    for (const theme of [...TIERS.map((tier) => THEMES[tier]), CLEAN_THEME]) {
      expect(contrastRatio(theme.text, theme.bg)).toBeGreaterThan(7);
      expect(contrastRatio(theme.dim, theme.bg)).toBeGreaterThan(4.5);
    }
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBe(1);
  });
});

describe("wish-card caption", () => {
  it("builds a tier-appropriate found caption", () => {
    expect(buildCaption(input({ expected: 0.000001 }))).toContain("Legendary find.");
    expect(buildCaption(input({ expected: 0.000001 }))).toContain("A 1 in 1 million chance");
    expect(buildCaption(input({ expected: 0.1 }))).toContain("Rare find.");
    expect(buildCaption(input())).toContain("Found 12 in π at position 148.");
    const caption = buildCaption(input());
    expect(caption).toContain("Try yours:");
    expect(caption).toContain("#PiAtlas #pi");
  });

  it("builds the not-found caption from the actual dataset size", () => {
    expect(buildCaption(input({ found: false, datasetWords: "1 billion digits" })))
      .toContain("12 was not in the first 1 billion digits of π.");
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
    expect(stripQueryFromUrl("https://x.test/pi/#/explore/digits?q=12")).toBe(
      "https://x.test/pi/#/explore/digits",
    );
  });

  it("inserts a dedication before 'Try yours:' and never in the URL", () => {
    const card = input({ dedication: "For Ana" });
    const caption = buildCaption(card);
    expect(caption).toContain("For Ana. Try yours:");
    expect(caption.indexOf("For Ana")).toBeLessThan(caption.indexOf("Try yours:"));
    expect(card.shareUrl).not.toContain("Ana");
    expect(buildCaption(input({ hideQuery: true, dedication: "Ana" }))).not.toContain("q=Ana");
  });

  it("strips the banner marker from every caption link", () => {
    const marked = "https://pi.test/pi/#/explore/digits?q=12&src=card";
    expect(stripSrcCard(marked)).toBe("https://pi.test/pi/#/explore/digits?q=12");
    expect(buildCaption(input(), marked)).not.toContain("src=card");
    expect(buildCaption(input({ hideQuery: true }), marked)).not.toContain("src=card");
  });
});

describe("wish-card QR fallback", () => {
  it("uses the full share URL for normal searches", () => {
    const card = input();
    const content = qrContentFor(card);
    expect(content.text).toBe(`${card.shareUrl}&src=card`);
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

  it("adds src=card to the QR payload only, for normal and hidden cards", () => {
    const normal = qrContentFor(input());
    expect(normal.text).toContain("src=card");
    expect(normal.text).toContain("q=12");
    const hidden = qrContentFor(input({ hideQuery: true }));
    expect(hidden.text).toContain("src=card");
    expect(hidden.text).not.toContain("q=12");
    expect(buildCaption(input())).not.toContain("src=card");
    expect(buildCaption(input({ hideQuery: true }))).not.toContain("src=card");
    expect(buildShareUrl("/explore/digits", { mode: "digits", query: "12" })).not.toContain("src=card");
  });

  it("falls back to a parameter-free URL when the marked QR is too dense", () => {
    const longQuery = "9".repeat(1500);
    const card = input({ query: longQuery, shareUrl: `https://pi.test/pi-atlas/#/explore/digits?q=${longQuery}` });
    const content = qrContentFor(card);
    expect(content.shortened).toBe(true);
    expect(content.text).not.toContain("src=card");
    expect(content.text).toBe("https://pi.test/pi-atlas/#/explore/digits");
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
    expect(fileNameFor(input({ hideQuery: true, mode: "letters" }), "wide"))
      .toBe("pi-atlas-wish-letters-hidden-wide.png");
  });

  it("has the exact format sizes and fixed QR plates", () => {
    expect(FORMATS).toEqual({
      square: { width: 1080, height: 1080, margin: 72 },
      story: { width: 1080, height: 1920, margin: 72 },
      wide: { width: 1200, height: 630, margin: 24 },
    });
    expect(qrPlateFor("square", "collectible")).toEqual({ x: 836, y: 836, size: 172 });
    expect(qrPlateFor("story", "collectible")).toEqual({ x: 72, y: 1330, size: 220 });
    expect(qrPlateFor("wide", "collectible")).toEqual({ x: 872, y: 120, size: 220 });
    expect(qrPlateFor("story", "clean")).toEqual({ x: 410, y: 1300, size: 260 });
  });

  it("keeps text boxes inside margins, above 12 px, and off the QR plate", () => {
    for (const format of ["square", "story", "wide"] as const) {
      const spec = FORMATS[format];
      const plate = qrPlateFor(format, "collectible");
      const boxes = layoutBoxes(format, input({ dedication: "For Ana" }))
        .filter((box) => !box.decorative);
      expect(boxes.length).toBeGreaterThan(8);
      for (const box of boxes) {
        expect(box.minSize).toBeGreaterThanOrEqual(12);
        expect(box.x).toBeGreaterThanOrEqual(spec.margin - 2);
        expect(box.y).toBeGreaterThanOrEqual(spec.margin - 2);
        expect(box.x + box.w).toBeLessThanOrEqual(spec.width - spec.margin + 2);
        expect(box.y + box.h).toBeLessThanOrEqual(spec.height - spec.margin + 2);
        const onPlate = box.x < plate.x + plate.size && box.x + box.w > plate.x &&
          box.y < plate.y + plate.size && box.y + box.h > plate.y;
        expect(onPlate).toBe(false);
      }
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          expect(overlap, `${format}: ${a.id} / ${b.id}`).toBe(false);
        }
      }
      expect(LAYOUTS[format].qr.size).toBeGreaterThan(100);
    }
  });

  it("keys the cache on every visible choice", () => {
    const base = input();
    const key = cacheKeyFor(base, DEFAULT_WISH_OPTIONS);
    expect(key).toBe(cacheKeyFor(input(), { ...DEFAULT_WISH_OPTIONS }));
    expect(cacheKeyFor(base, { ...DEFAULT_WISH_OPTIONS, format: "story" })).not.toBe(key);
    expect(cacheKeyFor(base, { ...DEFAULT_WISH_OPTIONS, style: "clean" })).not.toBe(key);
    expect(cacheKeyFor(base, { ...DEFAULT_WISH_OPTIONS, hideQuery: true })).not.toBe(key);
    expect(cacheKeyFor({ ...base, dedication: "Ana" }, DEFAULT_WISH_OPTIONS)).not.toBe(key);
    expect(cacheKeyFor({ ...base, subject: "loved" }, DEFAULT_WISH_OPTIONS)).not.toBe(key);
    expect(cacheKeyFor({ ...base, tier: "gold" }, DEFAULT_WISH_OPTIONS)).not.toBe(key);
  });
});
