import { describe, it, expect } from "vitest";
import { digits } from "../helpers/dataset";
import {
  searchDigits,
  sanitizeQuery,
  clampQuery,
  contextAt,
} from "../../src/engine/digitsSearch";
import { DATASET_SIZE } from "../../src/constants";


describe("digitsSearch (real dataset)", () => {
  it("dataset has exactly 2,000,000 digits", () => {
    expect(digits.length).toBe(DATASET_SIZE);
  });

  it("finds single digits", () => {
    const r = searchDigits(digits, "1");
    expect(r.found).toBe(true);
    expect(r.positions[0]).toBe(1);
    expect(r.total).toBe(r.positions.length);
  });

  it("first occurrence of '12' is at position 148 (checkpoint)", () => {
    const r = searchDigits(digits, "12");
    expect(r.positions[0]).toBe(148);
    expect(r.total).toBeGreaterThan(0);
  });

  it("first occurrence of '999999' is at position 762 (checkpoint)", () => {
    const r = searchDigits(digits, "999999");
    expect(r.positions[0]).toBe(762);
  });

  it("counts overlapping matches correctly", () => {
    // synthetic haystack with overlapping "11"s
    const r = searchDigits("011101", "11");
    expect(r.total).toBe(2); // 0-based starts 1 and 2 overlap
    expect(r.positions).toEqual([2, 3]); // 1-based positions
  });

  it("handles missing patterns and finds the longest existing prefix", () => {
    // a 20-digit random tail is overwhelmingly absent
    const missing = "90909090909090909091";
    const r = searchDigits(digits, missing);
    expect(r.found).toBe(false);
    expect(r.total).toBe(0);
    expect(r.longestExistingPrefix).toBeGreaterThan(0);
    expect(r.longestExistingPrefixPosition).toBeGreaterThan(0);
    // the prefix itself must exist
    const prefixResult = searchDigits(digits, missing.slice(0, r.longestExistingPrefix));
    expect(prefixResult.found).toBe(true);
  });

  it("expected count follows (N - L + 1)/10^L", () => {
    const r = searchDigits(digits, "42");
    expect(r.expectedCount).toBeCloseTo((DATASET_SIZE - 2 + 1) / 100, 5);
    expect(r.expectedFirstDepth).toBe(100);
  });

  it("luck ratio = actual / expected", () => {
    const r = searchDigits(digits, "12");
    expect(r.luckRatio).toBeCloseTo(r.total / r.expectedCount, 8);
  });

  it("long queries are accepted up to 20 chars", () => {
    const q = "31415926535897932384"; // 20 digits
    const r = searchDigits(digits, q);
    expect(r.length).toBe(20);
    expect(typeof r.found).toBe("boolean");
  });

  it("boundary positions: first and last digits are searchable", () => {
    const first = searchDigits(digits, digits.slice(0, 8));
    expect(first.positions[0]).toBe(1);
    const last = searchDigits(digits, digits.slice(-8));
    expect(last.found).toBe(true);
    expect(last.positions.at(-1)).toBeLessThanOrEqual(DATASET_SIZE - 8 + 1);
  });
});

describe("sanitizeQuery", () => {
  it("keeps digits, strips junk, reports removed characters", () => {
    const { cleaned, removed } = sanitizeQuery("12a34-bc5");
    expect(cleaned).toBe("12345");
    expect(removed).toBe("abc");
  });

  it("silently drops separators", () => {
    const { cleaned, removed } = sanitizeQuery("12, 34.56_78");
    expect(cleaned).toBe("12345678");
    expect(removed).toBe("");
  });
});

describe("clampQuery", () => {
  it("truncates to 20 digits", () => {
    expect(clampQuery("1234567890123456789012345")).toHaveLength(20);
  });
});

describe("contextAt", () => {
  it("returns surrounding digits and the match", () => {
    const ctx = contextAt(digits, 148, 2, 5);
    expect(ctx.match).toBe("12");
    expect(ctx.before).toHaveLength(5);
    expect(ctx.after).toHaveLength(5);
  });

  it("clips at the start of the dataset", () => {
    const ctx = contextAt(digits, 1, 1, 5);
    expect(ctx.before).toBe("");
    expect(ctx.match).toBe(digits[0]);
  });
});

describe("digitsSearch runtime hardening", () => {
  it("returns an empty result for empty/non-digit queries (no infinite loop)", () => {
    for (const q of ["", "abc", "12a", "١٢٣"]) {
      const r = searchDigits("14159265", q);
      expect(r.found).toBe(false);
      expect(r.total).toBe(0);
      expect(r.positions).toEqual([]);
    }
  });

  it("derives expectedCount from the runtime haystack, not a hardcoded fixture", () => {
    const r = searchDigits("1415", "14");
    expect(r.expectedCount).toBeCloseTo(3 / 100, 12);
    expect(searchDigits("", "1").expectedCount).toBe(0);
  });

  it("clamps hostile positions, lengths and radii in contextAt", () => {
    const hay = "0123456789";
    expect(contextAt(hay, NaN, 2, 3)).toEqual({ before: "", match: "01", after: "234" });
    expect(contextAt(hay, -50, 2, 3).match).toBe("01");
    expect(contextAt(hay, 4, -5, 3).match).toBe("");
    expect(contextAt(hay, 4, 2, -3).after).toBe("");
    expect(contextAt(hay, 6, 2, 1.9).after).toBe("7");
  });
});
