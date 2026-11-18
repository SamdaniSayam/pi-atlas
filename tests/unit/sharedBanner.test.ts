import { describe, expect, it } from "vitest";
import {
  buildBannerText,
  parseSrc,
  stripSrc,
  truncateQuery,
  type SharedBannerResult,
} from "../../src/lib/sharedBanner";

describe("shared banner URL gate", () => {
  it("accepts only one exact src=card", () => {
    expect(parseSrc(new URLSearchParams("q=12&src=card"))).toBe(true);
    expect(parseSrc(new URLSearchParams("src=card&q=12"))).toBe(true);
  });

  it("ignores wrong, repeated, empty and script-like values", () => {
    expect(parseSrc(new URLSearchParams("src=Card"))).toBe(false);
    expect(parseSrc(new URLSearchParams("src=card2"))).toBe(false);
    expect(parseSrc(new URLSearchParams("src="))).toBe(false);
    expect(parseSrc(new URLSearchParams("src=card&src=card"))).toBe(false);
    expect(parseSrc(new URLSearchParams("src=%3Cscript%3Ealert(1)%3C%2Fscript%3E"))).toBe(false);
    expect(parseSrc(new URLSearchParams("q=12"))).toBe(false);
  });

  it("strips src while preserving every other parameter and its order", () => {
    const before = new URLSearchParams("q=12&src=card&occ=2&frame=B&src=evil&p=%5B1%5D");
    expect(stripSrc(before).toString()).toBe("q=12&occ=2&frame=B&p=%5B1%5D");
    expect(before.get("src")).toBe("card");
  });
});

describe("shared banner copy", () => {
  it("truncates long queries to first 8, ellipsis, last 8", () => {
    expect(truncateQuery("123456789012345678901")).toBe("12345678…45678901");
    expect(truncateQuery("12345678901234567890")).toBe("12345678901234567890");
  });

  it("uses the found result's own query and position", () => {
    const digits: SharedBannerResult = { kind: "digits", found: true, query: "12", position: 148 };
    expect(buildBannerText(digits, "1 billion digits"))
      .toBe("Someone found 12 in π at position 148. Try your own.");
    const letters: SharedBannerResult = { kind: "letters", found: true, query: "PI", position: 1_234_567 };
    expect(buildBannerText(letters, "1 billion digits"))
      .toBe("Someone found PI in π at position 1,234,567. Try your own.");
  });

  it("uses row and column for patterns and shapes", () => {
    const pixels: SharedBannerResult = { kind: "pixels", found: true, row: 3, column: 7 };
    expect(buildBannerText(pixels, "1 billion digits"))
      .toBe("Someone found a pattern in π at row 3, column 7. Try your own.");
    const shapes: SharedBannerResult = { kind: "shapes", found: true, row: 11, column: 42 };
    expect(buildBannerText(shapes, "1 billion digits"))
      .toBe("Someone found a shape in π at row 11, column 42. Try your own.");
  });

  it("uses manifest words for not-found searches", () => {
    const missing: SharedBannerResult = { kind: "digits", found: false, query: "12", position: null };
    expect(buildBannerText(missing, "1 billion digits"))
      .toBe("Someone searched π for 12 and it wasn’t in the first 1 billion digits. Try your own.");
  });

  it("truncates a missing query longer than 20 characters", () => {
    const missing: SharedBannerResult = {
      kind: "digits",
      found: false,
      query: "123456789012345678901",
      position: null,
    };
    expect(buildBannerText(missing, "1 billion digits"))
      .toContain("12345678…45678901");
  });

  it("uses generic copy when no search result is available", () => {
    expect(buildBannerText(null, "1 billion digits"))
      .toBe("Someone shared a search of π with you. Try your own.");
    expect(buildBannerText({ kind: "shapes", found: false, row: null, column: null }, "1 billion digits"))
      .toBe("Someone shared a search of π with you. Try your own.");
  });
});
