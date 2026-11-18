/** Public wish-card API. Reached only through a dynamic import from the app. */
import { fetchDigitRange } from "../data/digitWindow";
import { buildShareUrl } from "../lib/url";
import { expectedPatternMatches, type PatternSpec } from "../engine/patternSearch";
import type { DigitsSearchResult } from "../engine/digitsSearch";
import type { LetterSearchResult } from "../engine/lettersSearch";
import type { PatternResult } from "../data/piApi";
import { stripQueryFromUrl } from "./caption";
import type { WishCardInput } from "./types";

export { buildCaption, stripQueryFromUrl } from "./caption";
export { FINE_PRINT, datasetShort, datasetWords, eyebrow, hashString, pickCopy } from "./copy";
export { FORMATS, cacheKeyFor, ellipsizeMiddle, fileNameFor, fitText, slugFor } from "./layout";
export { clearWishCardCache, renderWishCard, waitForFonts, whenIdle } from "./render";
export { DEFAULT_WISH_OPTIONS } from "./types";
export type { WishCardInput, WishCopy, WishFormat, WishMode, WishOptions, WishStyle } from "./types";

type Mode = "pixels" | "shapes";

function contextFromDigits(digits: string, position: number, matchLength: number) {
  const start = Math.max(1, position - 12);
  const end = Math.min(digits.length, position + matchLength + 12);
  const text = digits.slice(start - 1, end);
  return { text, matchStart: start > 0 ? position - start : 0, matchLength };
}

/** Digits (and date-helper digit searches). */
export async function buildWishInputForDigits(
  result: DigitsSearchResult,
  occurrence: number,
  fromDateHelper: boolean,
  hideQuery: boolean,
  datasetSize: number,
): Promise<WishCardInput> {
  const pos = result.found ? result.positions[Math.max(0, occurrence - 1)] ?? result.positions[0] : null;
  let context: WishCardInput["context"] = null;
  if (pos !== null) {
    // Keep the fetch tight: 30 characters centred on the match.
    const start = Math.max(1, pos - 12);
    try {
      const digits = await fetchDigitRange(start, Math.min(30, result.length + 24));
      context = contextFromDigits(digits, pos - start + 1, result.length);
    } catch {
      context = null;
    }
  }
  let shareUrl = buildShareUrl("/explore/digits", {
    mode: "digits",
    query: result.query,
    occurrence,
  });
  if (hideQuery) shareUrl = stripQueryFromUrl(shareUrl);
  void fromDateHelper; // only controls the dialog's default privacy switch
  return {
    mode: "digits",
    found: result.found,
    query: result.query,
    count: result.found ? result.total : 0,
    firstPosition: pos,
    expected: result.expectedCount,
    expectedDepthLog10: Math.log10(Math.max(1, result.expectedFirstDepth)),
    datasetSize,
    longestPrefix: result.longestExistingPrefix > 0
      ? { prefix: result.query.slice(0, result.longestExistingPrefix), position: result.longestExistingPrefixPosition }
      : null,
    context,
    shareUrl,
    hideQuery,
  };
}

/** Letters (both frames). */
export async function buildWishInputForLetters(
  result: LetterSearchResult,
  hideQuery: boolean,
  datasetSize: number,
): Promise<WishCardInput> {
  const frame = result.frames.find((f) => f.total > 0)?.frame ?? "A";
  const match = result.frames.find((f) => f.frame === frame)?.matches[0];
  const pos = match?.position ?? null;
  const matchLength = result.pairValues.length * 2;
  let context: WishCardInput["context"] = null;
  if (pos !== null) {
    const start = Math.max(1, pos - 12);
    try {
      const digits = await fetchDigitRange(start, Math.min(30, matchLength + 24));
      context = contextFromDigits(digits, pos - start + 1, matchLength);
    } catch {
      context = null;
    }
  }
  let shareUrl = buildShareUrl("/explore/letters", {
    mode: "letters",
    query: result.word,
    frame,
  });
  if (hideQuery) shareUrl = stripQueryFromUrl(shareUrl);
  return {
    mode: "letters",
    found: result.total > 0,
    query: result.word,
    count: result.total,
    firstPosition: pos,
    expected: result.expectedCount,
    expectedDepthLog10: Math.log10(Math.max(1, result.expectedFirstDepth)),
    datasetSize,
    longestPrefix: null,
    context,
    frame,
    shareUrl,
    hideQuery,
  };
}

/** Pixels and shapes. */
export async function buildWishInputForPattern(
  result: PatternResult,
  spec: PatternSpec,
  exact: boolean,
  fieldWidth: number,
  datasetSize: number,
  mode: Mode,
  hideQuery: boolean,
): Promise<WishCardInput> {
  const match = result.matches[0];
  const pos = match?.position ?? null;
  let region: NonNullable<WishCardInput["pattern"]>["region"];
  if (match) {
    const r0 = Math.max(0, match.row - 2);
    const c0 = Math.max(0, match.col - 2);
    const r1 = Math.min(Math.floor(datasetSize / fieldWidth) - 1, match.row + spec.rows + 1);
    const c1 = Math.min(fieldWidth - 1, match.col + spec.cols + 1);
    try {
      const digits = await fetchDigitRange(r0 * fieldWidth + 1, (r1 - r0 + 1) * fieldWidth);
      const values: number[] = [];
      for (let r = r0; r <= r1; r += 1) {
        for (let c = c0; c <= c1; c += 1) {
          values.push(Number(digits[(r - r0) * fieldWidth + c] ?? "0"));
        }
      }
      region = {
        rows: r1 - r0 + 1,
        cols: c1 - c0 + 1,
        values,
        matchRow: match.row - r0,
        matchCol: match.col - c0,
      };
    } catch {
      region = undefined;
    }
  }
  const urlMode = mode === "pixels" ? "colors" : "shapes";
  let shareUrl = buildShareUrl(`/explore/${urlMode}`, {
    mode: urlMode,
    pattern: spec.cells,
    patternRows: spec.rows,
    patternCols: spec.cols,
    exact,
    fieldWidth,
  });
  if (hideQuery) shareUrl = stripQueryFromUrl(shareUrl);
  const kind = mode === "pixels" ? "color" : "shape";
  return {
    mode,
    found: result.total > 0,
    query: `${spec.rows}x${spec.cols}:${spec.cells.join(",")}`,
    count: result.total,
    firstPosition: pos,
    expected: expectedPatternMatches(spec, fieldWidth, datasetSize),
    expectedDepthLog10: Math.log10(Math.max(1, expectedPatternMatches(spec, fieldWidth, datasetSize))),
    datasetSize,
    longestPrefix: null,
    context: null,
    pattern: { rows: spec.rows, cols: spec.cols, cells: spec.cells, kind, exact, region },
    shareUrl,
    hideQuery,
  };
}
