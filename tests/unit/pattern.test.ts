import { describe, it, expect } from "vitest";
import {
  searchPattern,
  expectedPatternMatches,
  countConstrained,
  digitToCellValue,
  type PatternSpec,
} from "../../src/engine/patternSearch";

const SILENT = { datasetSize: 1_000_000, matchCap: 1000 };

describe("digitToCellValue", () => {
  it("colour mode is identity", () => {
    expect(digitToCellValue(0, true)).toBe(0);
    expect(digitToCellValue(9, true)).toBe(9);
  });
  it("shape mode is binary", () => {
    expect(digitToCellValue(0, false)).toBe(0);
    expect(digitToCellValue(4, false)).toBe(0);
    expect(digitToCellValue(5, false)).toBe(1);
    expect(digitToCellValue(9, false)).toBe(1);
  });
});

describe("searchPattern: no wrapping across rows", () => {
  // Shape-mode streams: digits 5–9 → cell 1 (white), 0–4 → cell 0 (black).
  // Rows: "5500" (white white …), "0550", "0055"
  const digits = "55000550005500";
  const spec: PatternSpec = { rows: 1, cols: 2, cells: [1, 1], colourMode: false };

  it("finds only in-row horizontal matches", () => {
    const r = searchPattern(digits, spec, { ...SILENT, fieldCols: 4 });
    // rows: 5500 (col 0), 0550 (col 1), 0055 (col 2) → 3 matches
    expect(r.total).toBe(3);
    expect(r.matches.map((m) => m.position)).toEqual([1, 6, 11]);
  });

  it("a pattern spanning the row edge never matches across rows", () => {
    // Shape stream "5000", fieldCols 2 → rows "50" (cells [1,0]) and "00" ([0,0]).
    // Pattern [0,0]: valid anchor row2:col0 matches. A wrapping implementation
    // would also match row1:col1 pairing row1col1 + row2col0.
    const spec2: PatternSpec = { rows: 1, cols: 2, cells: [0, 0], colourMode: false };
    const r = searchPattern("5000", spec2, { ...SILENT, fieldCols: 2 });
    expect(r.total).toBe(1);
    expect(r.matches[0].position).toBe(3);
  });
});

describe("searchPattern: wildcards and modes", () => {
  it("wildcard (-1) matches any digit", () => {
    const spec: PatternSpec = { rows: 1, cols: 3, cells: [1, -1, 1], colourMode: true };
    const r = searchPattern("101111111", spec, { ...SILENT, fieldCols: 3 });
    // rows "101","111","111": one anchor per row (pattern spans full width)
    expect(r.total).toBe(3);
  });

  it("exact vs ink-only shape matching", () => {
    // digits "505" → cells [1,0,1]
    const digits = "505";
    const exact: PatternSpec = { rows: 1, cols: 3, cells: [1, 0, 1], colourMode: false };
    const inkOnlyWithWildcard: PatternSpec = { rows: 1, cols: 3, cells: [1, -1, 1], colourMode: false };
    expect(searchPattern(digits, exact, { ...SILENT, fieldCols: 3 }).total).toBe(1);
    expect(searchPattern(digits, inkOnlyWithWildcard, { ...SILENT, fieldCols: 3 }).total).toBe(1);
    // digits "515" → cells [1,0,1] as well (1 < 5 → black)
    const digits2 = "515";
    expect(searchPattern(digits2, exact, { ...SILENT, fieldCols: 3 }).total).toBe(1);
    // digits "555" → cells [1,1,1]: fails exact (middle must be black), passes ink-only
    const digits3 = "555";
    expect(searchPattern(digits3, exact, { ...SILENT, fieldCols: 3 }).total).toBe(0);
    expect(searchPattern(digits3, inkOnlyWithWildcard, { ...SILENT, fieldCols: 3 }).total).toBe(1);
  });

  it("counts beyond the storage cap and flags capped", () => {
    const spec: PatternSpec = { rows: 1, cols: 1, cells: [1], colourMode: true };
    const r = searchPattern("1111111111", spec, { ...SILENT, fieldCols: 10, matchCap: 3 });
    expect(r.total).toBe(10);
    expect(r.matches).toHaveLength(3);
    expect(r.capped).toBe(true);
  });

  it("supports cancellation between chunks", () => {
    const spec: PatternSpec = { rows: 1, cols: 1, cells: [0], colourMode: true };
    let calls = 0;
    const r = searchPattern("0000000000", spec, {
      ...SILENT,
      fieldCols: 2,
      chunkRows: 1,
      isCancelled: () => ++calls > 1,
    });
    expect(r.cancelled).toBe(true);
    expect(r.total).toBeLessThan(5);
  });

  it("reports progress", () => {
    const spec: PatternSpec = { rows: 1, cols: 1, cells: [0], colourMode: true };
    const events: Array<[number, number]> = [];
    searchPattern("000000", spec, {
      ...SILENT,
      fieldCols: 2,
      chunkRows: 1,
      onProgress: (checked, total) => events.push([checked, total]),
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)![0]).toBe(events.at(-1)![1]);
  });
});

describe("searchPattern boundary hardening", () => {
  it("never anchors a multi-row pattern on a partial last row", () => {
    // 8 digits / 3 columns = rows "111","111","11"; only rows 0 and 1 are
    // complete, so a 2-row pattern has exactly one anchor row.
    const digits = "11111111";
    const spec: PatternSpec = { rows: 2, cols: 1, cells: [1, 1], colourMode: true };
    const r = searchPattern(digits, spec, { ...SILENT, fieldCols: 3 });
    expect(r.total).toBe(3);
    expect(r.matches.every((m) => m.position <= 6)).toBe(true);
  });

  it("returns no anchors for invalid field or pattern dimensions", () => {
    const spec: PatternSpec = { rows: 1, cols: 2, cells: [1, 1], colourMode: true };
    for (const fieldCols of [0, -4, NaN]) {
      const r = searchPattern("111111", spec, { ...SILENT, fieldCols });
      expect(r.total).toBe(0);
      expect(r.anchors).toBe(0);
    }
    const tooWide: PatternSpec = { rows: 1, cols: 5, cells: [1, 1, 1, 1, 1], colourMode: true };
    expect(searchPattern("111111", tooWide, { ...SILENT, fieldCols: 3 }).anchors).toBe(0);
  });
});

describe("expectedPatternMatches", () => {
  it("uses anchors / base^k", () => {
    const spec: PatternSpec = { rows: 1, cols: 2, cells: [1, 2], colourMode: true };
    // dataset 1000, field 10 wide → 100 rows; anchors = 100 × (10-2+1) = 900
    const expected = expectedPatternMatches(spec, 10, 1000);
    expect(expected).toBeCloseTo((100 * (10 - 2 + 1)) / 100, 8);
  });

  it("counts only constrained cells", () => {
    expect(countConstrained([1, -1, 2, -1])).toBe(2);
  });
});
