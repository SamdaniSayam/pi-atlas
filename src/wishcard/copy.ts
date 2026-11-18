/** Deterministic copy deck. Same input always produces the same card text. */
import type { WishCardInput, WishCopy, WishMode } from "./types";

export const FINE_PRINT = "Statistics, not magic.";

/** Human-readable size of the dataset actually scanned (never hardcoded). */
export function datasetWords(size: number): string {
  if (size >= 1_000_000_000 && size % 1_000_000_000 === 0) return `${size / 1_000_000_000} billion`;
  if (size >= 1_000_000 && size % 1_000_000 === 0) return `${size / 1_000_000} million`;
  return size.toLocaleString("en-US");
}

/** Compact form used in the card header and the not-found stats column. */
export function datasetShort(size: number): string {
  if (size >= 1_000_000_000 && size % 1_000_000_000 === 0) return `${size / 1_000_000_000}B digits`;
  if (size >= 1_000_000 && size % 1_000_000 === 0) return `${size / 1_000_000}M digits`;
  return `${size.toLocaleString("en-US")} digits`;
}

const THINGS: Record<WishMode, string> = {
  digits: "number",
  letters: "word",
  pixels: "colour pattern",
  shapes: "shape",
};

const FOUND_HEADLINES = [
  "Found in π.",
  "Your {thing} lives in π.",
  "Spotted in the digits!",
  "Pin dropped in π.",
  "π had a spot for it.",
];

const NOT_FOUND_HEADLINES = [
  "π hasn’t met it yet.",
  "Not in these digits.",
  "Hiding deeper in π.",
  "Too rare for this stretch.",
  "Better luck, next digit.",
];

/** FNV-1a, 32-bit. Stable across browsers and runs. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function pick(pool: readonly string[], key: string): string {
  return pool[hashString(key) % pool.length];
}

function formatDepth(log10: number): string {
  const k = Math.max(1, Math.round(log10));
  const superscript: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  };
  return `10${String(k).split("").map((d) => superscript[d]).join("")}`;
}

export function eyebrow(input: WishCardInput): string {
  if (!input.found) {
    const queryLength = input.query.length;
    const close =
      (input.mode === "digits" || input.mode === "letters") &&
      input.longestPrefix !== null &&
      input.longestPrefix.prefix.length >= queryLength - 1;
    return close ? "SO CLOSE" : "NOT THIS TIME";
  }
  if (input.count >= 100) return "NICE FIND";
  if (input.count >= 10) return "CONGRATULATIONS";
  return "RARE FIND";
}

export function pickCopy(input: WishCardInput): WishCopy {
  const thing = THINGS[input.mode];
  const headlineTemplate = input.found
    ? pick(FOUND_HEADLINES, `${input.mode}|${input.query}|found`)
    : pick(NOT_FOUND_HEADLINES, `${input.mode}|${input.query}|missing`);
  const headline = headlineTemplate.replace("{thing}", thing);

  let subline: string;
  if (input.found) {
    const where =
      input.mode === "pixels" || input.mode === "shapes"
        ? (() => {
            const region = input.pattern?.region;
            return region ? `row ${region.matchRow}, column ${region.matchCol}` : "a matching row and column";
          })()
        : `position ${input.firstPosition?.toLocaleString("en-US") ?? "—"}`;
    const first = `in the first ${datasetWords(input.datasetSize)} digits of π`;
    const base =
      input.count === 1
        ? `Your ${thing} appears once ${first}, at ${where}.`
        : `Your ${thing} appears ${input.count.toLocaleString("en-US")} times ${first}. First one at ${where}.`;
    subline = input.mode === "letters" && input.frame ? `${base} Frame ${input.frame}.` : base;
  } else {
    subline = `Longer patterns need far more digits. Expected around digit ${formatDepth(input.expectedDepthLog10)}. Try a shorter one!`;
  }

  return { eyebrow: eyebrow(input), headline, subline, thing };
}
