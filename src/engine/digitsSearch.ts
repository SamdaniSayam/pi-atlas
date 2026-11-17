/**
 * Number search over the decimal digits of π.
 *
 * Internally zero-based indices; externally 1-based decimal positions
 * (position 1 = the first digit after the decimal point).
 * Matches are counted with overlapping semantics.
 */
import { DATASET_SIZE, MAX_NUMBER_QUERY_LENGTH } from "../constants";
import { difficultyFor, type DifficultyInfo } from "./format";

export interface DigitsSearchResult {
  query: string;
  length: number;
  found: boolean;
  /** 1-based decimal positions of every occurrence (capped by caller). */
  positions: number[];
  /** Total occurrence count in the whole dataset (uncapped). */
  total: number;
  /** Expected count under the uniform random-digit model. */
  expectedCount: number;
  /** actual / expected. */
  luckRatio: number;
  /** Expected first-occurrence depth under the model: 10^L. */
  expectedFirstDepth: number;
  /** Longest prefix that exists in the dataset (0 if the full query was found). */
  longestExistingPrefix: number;
  /** Position of that prefix (1-based), or 0. */
  longestExistingPrefixPosition: number;
  difficulty: DifficultyInfo;
}

export function sanitizeQuery(raw: string): {
  cleaned: string;
  removed: string;
} {
  const removedChars: string[] = [];
  let cleaned = "";
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      cleaned += ch;
    } else if (ch === "," || ch === " " || ch === "\u00a0" || ch === "." || ch === "_" || ch === "-" || ch === "'" || ch === "\u2019" || ch === "\t") {
      // silently dropped separators
    } else {
      removedChars.push(ch);
    }
  }
  return { cleaned, removed: removedChars.join("") };
}

function countOccurrences(haystack: string, needle: string, cap: number): {
  positions: number[];
  total: number;
} {
  const positions: number[] = [];
  let total = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    total += 1;
    if (positions.length < cap) positions.push(idx + 1); // 1-based decimal position
    from = idx + 1; // overlapping matches
  }
  return { positions, total };
}

/**
 * Search for `rawQuery` in the digit string.
 * `matchCap` limits how many positions are stored (counting continues).
 */
export function searchDigits(
  digits: string,
  rawQuery: string,
  matchCap = 200_000,
): DigitsSearchResult {
  const L = rawQuery.length;
  const { positions, total } = countOccurrences(digits, rawQuery, matchCap);
  const expectedCount = (DATASET_SIZE - L + 1) / 10 ** L;
  const found = total > 0;

  let longestExistingPrefix = 0;
  let longestExistingPrefixPosition = 0;
  if (!found && L > 1) {
    for (let len = L - 1; len >= 1; len -= 1) {
      const prefix = rawQuery.slice(0, len);
      const idx = digits.indexOf(prefix);
      if (idx !== -1) {
        longestExistingPrefix = len;
        longestExistingPrefixPosition = idx + 1;
        break;
      }
    }
  }

  return {
    query: rawQuery,
    length: L,
    found,
    positions,
    total,
    expectedCount,
    luckRatio: found ? total / expectedCount : 0,
    expectedFirstDepth: 10 ** L,
    longestExistingPrefix,
    longestExistingPrefixPosition,
    difficulty: difficultyFor(expectedCount),
  };
}

export function clampQuery(raw: string): string {
  return raw.slice(0, MAX_NUMBER_QUERY_LENGTH);
}

/** Text context around a 1-based position, +/- `radius` digits. */
export function contextAt(
  digits: string,
  position: number,
  queryLength: number,
  radius = 24,
): { before: string; match: string; after: string } {
  const start = Math.max(0, position - 1 - radius);
  const matchStart = position - 1;
  const matchEnd = matchStart + queryLength;
  return {
    before: digits.slice(start, matchStart),
    match: digits.slice(matchStart, matchEnd),
    after: digits.slice(matchEnd, matchEnd + radius),
  };
}
