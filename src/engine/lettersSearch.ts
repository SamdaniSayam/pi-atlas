/**
 * Letter Explorer engine (FR-04).
 *
 * Encoding: 00=A … 25=Z, then 26=A … 99=V via
 *   letter = (10*a + b) mod 26
 *
 * Two independent pair alignments over the decimal digits:
 *   Frame A: pairs (0,1), (2,3), …
 *   Frame B: pairs (1,2), (3,4), …
 *
 * Under uniformly random digits, pairs reduce to k mod 26 for the values
 * k, k+26, k+52, k+78 — so A–V (4 pair-values each) have probability 4/100
 * and W–Z (3 pair-values each) have probability 3/100.
 */
import { MAX_WORD_LENGTH } from "../constants";
import { difficultyFor, type DifficultyInfo } from "./format";

export type FrameId = "A" | "B";

export interface LetterEncoding {
  letter: string;
  pair: string;
  value: number;
}

/** Normalize arbitrary input to A–Z, reporting stripped characters.
 * Whitespace is dropped silently (word separators); other non A–Z
 * characters are reported so the UI can notify the user (FR-04). */
export function normalizeWord(raw: string): { word: string; removed: string } {
  // NFD so accented letters decompose to base letter + combining mark
  const nfd = raw.normalize("NFD").toUpperCase();
  const stripped = nfd.replace(/\p{M}/gu, "");
  const removedChars: string[] = [];
  let word = "";
  for (const ch of stripped) {
    if (ch >= "A" && ch <= "Z") {
      word += ch;
    } else if (/\s/.test(ch)) {
      // silent separator
    } else {
      removedChars.push(ch);
    }
  }
  return { word: word.slice(0, MAX_WORD_LENGTH), removed: removedChars.join("") };
}

/** Display encoding for a word: the canonical 00–25 pair per letter. */
export function encodeWord(word: string): LetterEncoding[] {
  return [...word].map((ch) => {
    const v = ch.charCodeAt(0) - 65;
    return { letter: ch, pair: String(v).padStart(2, "0"), value: v };
  });
}

/** Probability of a single letter under the uniform-digit-pair model. */
export function letterProbability(value: number): number {
  return value <= 21 ? 0.04 : 0.03; // A–V: 4/100, W–Z: 3/100
}

export function wordProbability(values: number[]): number {
  let p = 1;
  for (const v of values) p *= letterProbability(v);
  return p;
}

export interface LetterMatch {
  frame: FrameId;
  /** Pair index within the frame (0-based). */
  letterIndex: number;
  /** 1-based decimal position of the first digit of the first pair. */
  position: number;
}

export interface LetterFrameResult {
  frame: FrameId;
  matches: LetterMatch[];
  total: number;
  capped: boolean;
}

export interface LetterSearchResult {
  word: string;
  pairValues: number[];
  pairs: LetterEncoding[];
  frames: [LetterFrameResult, LetterFrameResult];
  total: number;
  /** Probability of the word at a random aligned position under the model. */
  wordProbability: number;
  expectedCount: number;
  expectedFirstDepth: number;
  luckRatio: number;
  difficulty: DifficultyInfo;
}

const MATCH_CAP = 200_000;

/** KMP failure function over pair values. */
function failure(values: number[]): number[] {
  const f = new Array<number>(values.length).fill(0);
  let k = 0;
  for (let i = 1; i < values.length; i += 1) {
    while (k > 0 && values[i] !== values[k]) k = f[k - 1];
    if (values[i] === values[k]) k += 1;
    f[i] = k;
  }
  return f;
}

/**
 * Search a word in both frames over the digits.
 * Overlapping matches are counted (KMP continuation semantics).
 */
export function searchWord(digits: string, rawWord: string): LetterSearchResult | null {
  const { word } = normalizeWord(rawWord);
  if (!word) return null;

  const values = [...word].map((ch) => ch.charCodeAt(0) - 65);
  const pairs = encodeWord(word);
  const k = values.length;
  const f = failure(values);

  const frameResults: LetterFrameResult[] = [];
  let total = 0;

  for (const frame of ["A", "B"] as const) {
    const start = frame === "A" ? 0 : 1;
    const matches: LetterMatch[] = [];
    let frameTotal = 0;
    let capped = false;

    let s = 0; // pattern state
    let pairIdx = 0;
    let i = start;
    const n = digits.length;
    while (i + 1 < n) {
      const v = ((digits.charCodeAt(i) - 48) * 10 + (digits.charCodeAt(i + 1) - 48)) % 26;
      while (s > 0 && v !== values[s]) s = f[s - 1];
      if (v === values[s]) s += 1;
      if (s === k) {
        frameTotal += 1;
        if (matches.length < MATCH_CAP) {
          matches.push({
            frame,
            letterIndex: pairIdx - k + 1,
            position: start + 2 * (pairIdx - k + 1) + 1,
          });
        } else {
          capped = true;
        }
        s = f[s - 1]; // allow overlapping matches to continue
      }
      i += 2;
      pairIdx += 1;
    }

    frameResults.push({ frame, matches, total: frameTotal, capped });
    total += frameTotal;
  }

  const p = wordProbability(values);
  // Valid starting positions across both frames (pairs fully inside the data).
  const pairsA = Math.floor(digits.length / 2);
  const pairsB = Math.floor((digits.length - 1) / 2);
  const validStarts = Math.max(0, pairsA - k + 1) + Math.max(0, pairsB - k + 1);
  const expectedCount = validStarts * p;
  const expectedFirstDepth = p > 0 ? 1 / p : Number.POSITIVE_INFINITY;

  return {
    word,
    pairValues: values,
    pairs,
    frames: [frameResults[0], frameResults[1]],
    total,
    wordProbability: p,
    expectedCount,
    expectedFirstDepth,
    luckRatio: expectedCount > 0 ? total / expectedCount : 0,
    difficulty: difficultyFor(expectedCount),
  };
}
