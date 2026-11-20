import { describe, it, expect } from "vitest";
import { digits } from "../helpers/dataset";
import { DATE_FORMATS, isValidDate, isLeap, searchDate } from "../../src/engine/dates";

describe("date validation", () => {
  it("accepts valid dates including leap years", () => {
    expect(isValidDate(2024, 2, 29)).toBe(true);
    expect(isValidDate(2000, 2, 29)).toBe(true);
  });
  it("rejects invalid dates", () => {
    expect(isValidDate(2023, 2, 29)).toBe(false);
    expect(isValidDate(1900, 2, 29)).toBe(false); // century non-leap
    expect(isValidDate(2023, 13, 1)).toBe(false);
    expect(isValidDate(2023, 4, 31)).toBe(false);
    expect(isValidDate(2023, 0, 10)).toBe(false);
  });
  it("leap rule is correct", () => {
    expect(isLeap(2024)).toBe(true);
    expect(isLeap(2023)).toBe(false);
    expect(isLeap(1900)).toBe(false);
    expect(isLeap(2000)).toBe(true);
  });
});

describe("date encodings", () => {
  it("provides all six formats", () => {
    expect(DATE_FORMATS.map((f) => f.id)).toEqual([
      "DDMMYYYY", "MMDDYYYY", "YYYYMMDD", "DDMMYY", "MMDDYY", "YYMMDD",
    ]);
  });

  it("encodes correctly", () => {
    const ddmmYYYY = DATE_FORMATS[0].encode(1776, 7, 4);
    expect(ddmmYYYY).toBe("04071776");
    const yyyymmdd = DATE_FORMATS[2].encode(1969, 7, 20);
    expect(yyyymmdd).toBe("19690720");
    const yymmdd = DATE_FORMATS[5].encode(1969, 7, 20);
    expect(yymmdd).toBe("690720");
  });

  it("searches real dataset and sorts found first", () => {
    const { rows } = searchDate(digits, 2000, 1, 1);
    expect(rows.length).toBeGreaterThanOrEqual(4); // duplicates removed
    const firstFoundIdx = rows.findIndex((r) => r.result.found);
    if (firstFoundIdx > 0) {
      expect(rows.slice(0, firstFoundIdx).every((r) => !r.result.found)).toBe(true);
    }
    for (const row of rows) {
      expect(row.sequence).toMatch(/^\d+$/);
    }
  });

  it("rejects invalid dates with empty rows", () => {
    expect(searchDate(digits, 2023, 2, 30).rows).toHaveLength(0);
  });

  it("dedupes identical encodings (e.g. 0102/0201 palindromic cases)", () => {
    // 2011-11-11: DDMMYY = 111111, MMDDYY = 111111, YYMMDD = 111111 — same
    const { rows } = searchDate(digits, 2011, 11, 11);
    const seqs = rows.map((r) => r.sequence);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("zero-pads years shorter than four digits", () => {
    expect(DATE_FORMATS[0].encode(7, 1, 2)).toBe("02010007");
    expect(DATE_FORMATS[2].encode(7, 1, 2)).toBe("00070102");
    expect(DATE_FORMATS[3].encode(7, 1, 2)).toBe("020107");
    for (const f of DATE_FORMATS) expect(f.encode(7, 1, 2)).toMatch(/^\d+$/);
  });

  it("orders found formats by first position with a stable tie-break", () => {
    const hay = "111111" + "0000" + "20111111";
    const { rows } = searchDate(hay, 2011, 11, 11);
    // Found encodings come first, sorted by first position; the absent one
    // remains in the list so the UI can show every format that was checked.
    expect(rows.map((r) => r.sequence)).toEqual(["111111", "20111111", "11112011"]);
    expect(rows[0].result.positions[0]).toBe(1);
    expect(rows[1].result.positions[0]).toBe(11);
    expect(rows[2].result.found).toBe(false);
  });
});
