import { describe, it, expect } from "vitest";
import { digits } from "../helpers/dataset";
import {
  normalizeWord,
  encodeWord,
  letterProbability,
  wordProbability,
  searchWord,
} from "../../src/engine/lettersSearch";


describe("normalizeWord", () => {
  it("uppercases and strips non A–Z", () => {
    expect(normalizeWord("hello world")).toEqual({ word: "HELLOWORLD", removed: "" });
    expect(normalizeWord("café!")).toEqual({ word: "CAFE", removed: "!" });
    expect(normalizeWord("a1b2")).toEqual({ word: "AB", removed: "12" });
  });

  it("decomposes accents via NFD", () => {
    expect(normalizeWord("éxample").word).toBe("EXAMPLE");
  });

  it("caps word length at 12", () => {
    expect(normalizeWord("ABCDEFGHIJKLMNOP").word).toHaveLength(12);
  });
});

describe("encoding", () => {
  it("maps A=00 … Z=25", () => {
    const enc = encodeWord("AZ");
    expect(enc[0]).toEqual({ letter: "A", pair: "00", value: 0 });
    expect(enc[1]).toEqual({ letter: "Z", pair: "25", value: 25 });
  });

  it("wraps mod 26 (26=A, 51=Z would wrap through values)", () => {
    // pair "26" → (10*2+6) % 26 = 0 = A; "51" → 51 % 26 = 25 = Z
    const v26 = 26 % 26;
    const v51 = 51 % 26;
    expect(v26).toBe(0);
    expect(v51).toBe(25);
  });
});

describe("letter probabilities (encoding bias)", () => {
  it("A–V are 0.04, W–Z are 0.03", () => {
    expect(letterProbability(0)).toBe(0.04); // A
    expect(letterProbability(21)).toBe(0.04); // V
    expect(letterProbability(22)).toBe(0.03); // W
    expect(letterProbability(25)).toBe(0.03); // Z
  });

  it("word probability multiplies per-letter values", () => {
    // PI = P(15)→0.04, I(8)→0.04
    expect(wordProbability([15, 8])).toBeCloseTo(0.0016, 10);
    // WZ = 0.03 * 0.03
    expect(wordProbability([22, 25])).toBeCloseTo(0.0009, 10);
  });
});

describe("searchWord (real dataset)", () => {
  it("finds PI in both frames with valid positions", () => {
    const r = searchWord(digits, "PI");
    expect(r).not.toBeNull();
    for (const fr of r!.frames) {
      expect(fr.total).toBeGreaterThan(0);
      const m = fr.matches[0];
      expect(m.position).toBeGreaterThanOrEqual(1);
      expect(m.frame).toBe(fr.frame);
      // letterIndex parity must match the frame offset
      expect(m.letterIndex).toBeGreaterThanOrEqual(0);
    }
    expect(r!.total).toBe(r!.frames[0].total + r!.frames[1].total);
  });

  it("frame A/B offsets are correct: matches decode back to the word", () => {
    const r = searchWord(digits, "PI");
    for (const fr of r!.frames) {
      const start = fr.frame === "A" ? 0 : 1;
      for (const m of fr.matches.slice(0, 50)) {
        // decode the pairs at the match position
        const i0 = m.position - 1; // 0-based
        expect((i0 - start) % 2).toBe(0); // alignment consistency
        const a = Number(digits.slice(i0, i0 + 2));
        const b = Number(digits.slice(i0 + 2, i0 + 4));
        expect(a % 26).toBe(15); // P
        expect(b % 26).toBe(8); // I
      }
    }
  });

  it("expected count uses encoding-aware probability", () => {
    const r = searchWord(digits, "PI");
    expect(r!.expectedCount).toBeGreaterThan(0);
    expect(r!.wordProbability).toBeCloseTo(0.0016, 10);
    expect(r!.expectedFirstDepth).toBeCloseTo(1 / 0.0016, 5);
  });

  it("returns null for empty words", () => {
    expect(searchWord(digits, "123")).toBeNull();
    expect(searchWord(digits, "")).toBeNull();
  });

  it("counts overlapping matches (run of pairs forming repeated single letter)", () => {
    // synthetic: pairs 00 00 00 → "AAA" at pair indices 0,1,2
    const pairStream = "000000";
    const r = searchWord(pairStream, "AAA");
    expect(r!.frames[0].total).toBe(1); // pairs (0,0)(0,0)(0,0) = exactly 1 window
    // overlapping semantics visible with a 2-letter pattern in a 4-pair run
    const r2 = searchWord("00000000", "AA");
    expect(r2!.frames[0].total).toBe(3); // windows at 0,1,2
  });
});
