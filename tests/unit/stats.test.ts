import { describe, it, expect } from "vitest";
import { computeDigitStats } from "../../src/engine/stats";

describe("computeDigitStats runtime hardening", () => {
  it("uses the actual runtime dataset length", () => {
    const stats = computeDigitStats("0123456789");
    expect(stats.counts).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(stats.expected).toBe(1);
    expect(stats.chiSquare).toBe(0);
    expect(stats.stdDev).toBeCloseTo(Math.sqrt(0.9), 10);
    expect(stats.passesAt95).toBe(true);
  });

  it("handles an empty dataset without producing NaN", () => {
    const stats = computeDigitStats("");
    expect(stats.counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(stats.expected).toBe(0);
    expect(stats.chiSquare).toBe(0);
    expect(stats.maxDeviationPercent).toBe(0);
    expect(Number.isNaN(stats.chiSquare)).toBe(false);
  });

  it("rejects non-digit characters instead of silently indexing a wrong bucket", () => {
    expect(() => computeDigitStats("123a")).toThrow(/non-digit/);
    expect(() => computeDigitStats("12 3")).toThrow(/non-digit/);
  });
});
