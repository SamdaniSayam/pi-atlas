import { describe, it, expect } from "vitest";
import {
  computeOdds,
  compareToDataset,
  maxFindablePixels,
} from "../../src/engine/odds";
import { computeDigitStats } from "../../src/engine/stats";
import {
  formatInt,
  formatMagnitude,
  formatOneIn,
  difficultyFor,
} from "../../src/engine/format";
import { digits } from "../helpers/dataset";
import { CHI_SQUARE_95_DF9, DATASET_SIZE } from "../../src/constants";

describe("computeOdds", () => {
  it("log10 space = pixels × log10(colours)", () => {
    const odds = computeOdds(10, 4, 4);
    expect(odds.pixels).toBe(16);
    expect(odds.log10Space).toBeCloseTo(16, 10);
    expect(odds.probability).toBeCloseTo(1e-16, 25);
  });

  it("never overflows for huge patterns", () => {
    const odds = computeOdds(256, 64, 64);
    expect(Number.isFinite(odds.log10Space)).toBe(true);
    expect(odds.log10Space).toBeCloseTo(4096 * Math.log10(256), 6);
    expect(odds.probability).toBe(0); // underflow acceptable; log path stays exact
  });

  it("one-in for a single cell of 10 colours", () => {
    const odds = computeOdds(10, 1, 1);
    expect(formatOneIn(odds.probability)).toBe("1 in 10");
  });
});

describe("compareToDataset", () => {
  it("2x2 colour pattern is expected many times", () => {
    const odds = computeOdds(10, 2, 2);
    const c = compareToDataset(odds, DATASET_SIZE);
    expect(c.log10ExpectedMatches).toBeGreaterThan(1.9); // ≈ 100 expected matches
    expect(c.verdict).toContain("many times");
  });

  it("huge patterns are beyond the dataset", () => {
    const odds = computeOdds(10, 12, 12);
    const c = compareToDataset(odds, DATASET_SIZE);
    expect(c.log10ExpectedMatches).toBeLessThan(-3);
    expect(c.verdict).toContain("Astronomically");
  });

  it("counts fewer anchors when a tall image cannot fit in every row", () => {
    // 1,000 digits folded at width 10 = 100 rows. A 1x90 image can only start
    // in 11 rows; ignoring height would wrongly report all 100 rows.
    const flat = compareToDataset(computeOdds(10, 1, 1), 1000, 10);
    const tall = compareToDataset(computeOdds(10, 1, 90), 1000, 10);
    expect(flat.log10Anchors).toBeCloseTo(Math.log10(1000), 10);
    expect(tall.log10Anchors).toBeCloseTo(Math.log10(110), 10);
    expect(Number.isFinite(tall.log10ExpectedMatches)).toBe(true);
  });

  it("reports an impossible fit when the image is taller than the folded rows", () => {
    const c = compareToDataset(computeOdds(10, 4, 1000), 1000, 4);
    expect(c.log10Anchors).toBe(Number.NEGATIVE_INFINITY);
    expect(c.verdict).toMatch(/cannot fit/);
  });

  it("maxFindablePixels grows with dataset size", () => {
    const p2m = maxFindablePixels(10, 2_000_000);
    expect(p2m).toBeGreaterThanOrEqual(6); // 10^6 < 2×10^6 ≤ 10^7
    expect(p2m).toBeLessThan(8);
  });
});

describe("computeDigitStats (real dataset)", () => {
    const stats = computeDigitStats(digits);

  it("counts all digits with expected frequency N/10", () => {
    expect(stats.counts.reduce((a, b) => a + b, 0)).toBe(DATASET_SIZE);
    expect(stats.expected).toBe(DATASET_SIZE / 10);
  });

  it("chi-square is below the 95% critical value (16.919, 9 df)", () => {
    expect(stats.chiSquare).toBeLessThan(CHI_SQUARE_95_DF9);
    expect(stats.passesAt95).toBe(true);
  });

  it("deviations are small (within ~2σ of the uniform model)", () => {
    // σ ≈ 424 digits; 0.35% of 200,000 ≈ 700 ≈ 1.65σ — normal for 10 samples.
    expect(stats.maxDeviationPercent).toBeLessThan(0.5);
    expect(stats.stdDev).toBeCloseTo(Math.sqrt(DATASET_SIZE * 0.09), 4);
  });
});

describe("formatting", () => {
  it("groups integers", () => {
    expect(formatInt(1234567)).toBe("1,234,567");
  });

  it("magnitudes use scientific notation", () => {
    expect(formatMagnitude(3.9e8)).toContain("10^8");
    expect(formatMagnitude(5)).toBe("5");
  });

  it("one-in strings", () => {
    expect(formatOneIn(0.001)).toBe("1 in 1,000");
    expect(formatOneIn(0)).toBe("never");
  });
});

describe("difficultyFor", () => {
  it("classifies buckets", () => {
    expect(difficultyFor(5000).level).toBe("very-common");
    expect(difficultyFor(10).level).toBe("likely");
    expect(difficultyFor(0.01).level).toBe("unlikely");
    expect(difficultyFor(1e-30).level).toBe("practically-impossible");
  });
});
