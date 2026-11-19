/**
 * Calm, deterministic card copy. Every pool uses the same FNV-1a index with
 * its own salt (h = headline, s = subline, q = quote). All numbers come from
 * the result; no invented facts and no self-attributed quotations.
 */
import { formatDepth } from "./depth";
import { oneIn, tierLabel } from "./tiers";
import { SUBJECT_PHRASES, type WishCardInput, type WishCopy, type WishMode, type WishQuote } from "./types";

export const FINE_PRINT = "Odds assume random digits · Statistics, not magic.";

/** Human-readable size of the dataset actually scanned (never hardcoded). */
export function datasetWords(size: number): string {
  if (size >= 1_000_000_000 && size % 1_000_000_000 === 0) return `${size / 1_000_000_000} billion`;
  if (size >= 1_000_000 && size % 1_000_000 === 0) return `${size / 1_000_000} million`;
  return size.toLocaleString("en-US");
}

/** Full {D} token value, including the word "digits". */
export function datasetWordsWithDigits(size: number): string {
  return `${datasetWords(size)} digits`;
}

/** Compact form used in the zone-1 edition tag. */
export function datasetShort(size: number): string {
  if (size >= 1_000_000_000 && size % 1_000_000_000 === 0) return `${size / 1_000_000_000}B digits`;
  if (size >= 1_000_000 && size % 1_000_000 === 0) return `${size / 1_000_000}M digits`;
  return `${size.toLocaleString("en-US")} digits`;
}

/** Manifest-derived edition tag. Never claims a billion on the 2M dataset. */
export function editionTag(size: number): string {
  if (size >= 1_000_000_000 && size % 1_000_000_000 === 0) return `EDITION · ${size / 1_000_000_000}B`;
  if (size >= 1_000_000 && size % 1_000_000 === 0) return `EDITION · ${size / 1_000_000}M`;
  return `EDITION · ${size.toLocaleString("en-US")}`;
}

const THINGS: Record<WishMode, string> = {
  digits: "number",
  letters: "word",
  pixels: "colour pattern",
  shapes: "shape",
};

export const HEADLINES: Record<WishCardInput["tier"], readonly string[]> = {
  gold: ["A rare coordinate."],
  silver: ["Found in the stream."],
  aurora: ["Found in π."],
  twilight: ["Still uncharted."],
};

export const SUBLINES: Record<WishCardInput["tier"], readonly string[]> = {
  gold: ["Against the odds, it is here."],
  silver: ["A 1-in-{n} coordinate."],
  aurora: ["Your place in the sequence."],
  twilight: ["Not in this stretch of π."],
};

export const QUOTES: Record<WishCardInput["tier"], readonly WishQuote[]> = {
  gold: [
    { text: "A rare coordinate." },
    { text: "Against the odds, it is here." },
  ],
  silver: [
    { text: "Found in the stream." },
    { text: "A coordinate against the odds." },
  ],
  aurora: [
    { text: "Found in π." },
    { text: "Your place in the sequence." },
  ],
  twilight: [
    { text: "Still uncharted." },
    { text: "Not in this stretch of π." },
    { text: "We must know. We will know.", by: "David Hilbert, 1930" },
  ],
};

/** Banned by the honesty guard; "magic" is allowed only in FINE_PRINT. */
export const HONESTY_BANNED = [
  "destiny", "fate", "fated", "meant to be", "chosen",
  "cosmic message", "universe wants", "proves", "proof",
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

function pick<T>(pool: readonly T[], key: string, salt: string): T {
  return pool[hashString(`${salt}|${key}`) % pool.length];
}

function countLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count >= 200_000) return "200,000+";
  return count.toLocaleString("en-US");
}

function substitute(template: string, tokens: Record<string, string>): string {
  let out = template;
  for (const [name, value] of Object.entries(tokens)) {
    out = out.replaceAll(`{${name}}`, value);
  }
  // Defensive: copy must never render a raw token to a user.
  return out.replace(/\{[A-Za-z]+\}/g, "").replace(/[{}]/g, "");
}

/** Zone-2 label. Kept as `eyebrow` for older callers of the copy API. */
export function eyebrow(input: WishCardInput): string {
  return tierLabel(input);
}

/** Build all card copy from the input; pure and deterministic. */
export function pickCopy(input: WishCardInput): WishCopy {
  const { S, s } = SUBJECT_PHRASES[input.subject];
  const key = `${input.mode}|${input.query}|${input.tier}|${input.subject}`;
  const D = input.datasetWords || datasetWordsWithDigits(input.datasetSize);
  const region = input.pattern?.region;
  const p = (input.firstPosition ?? input.longestPrefix?.position ?? 0).toLocaleString("en-US");
  const r = region ? String(region.matchRow + 1) : "0";
  const c = region ? String(region.matchCol + 1) : "0";
  const count = countLabel(input.count);
  const n = input.tier === "gold" || input.tier === "silver" ? oneIn(input.expected) : "";
  const k = formatDepth(input.expectedDepthLog10);
  const prefix = input.hideQuery ? s : input.longestPrefix?.prefix ?? s;
  const tokens = { S, s, D, p, count, n, k, r, c, prefix };

  const headline = substitute(pick(HEADLINES[input.tier], key, "h"), tokens);
  const subline = substitute(pick(SUBLINES[input.tier], key, "s"), tokens);
  const chosen = pick(QUOTES[input.tier], key, "q");
  const quote: WishQuote = { ...chosen, text: substitute(chosen.text, tokens) };

  let odds: string;
  if (input.tier === "gold" || input.tier === "silver") {
    odds = "A 1 in {n} chance in {D}.";
  } else if (input.tier === "aurora") {
    const where = input.mode === "pixels" || input.mode === "shapes"
      ? "row {r}, column {c}" : "position {p}";
    odds = input.count === 1
      ? `Found once, at ${where}.`
      : `Found {count} times. First at ${where}.`;
  } else {
    odds = input.longestPrefix
      ? "Closest: {prefix} at position {p}."
      : "Expected around digit {k}. It may be out there.";
  }
  odds = substitute(odds, tokens);

  let factLine: string;
  if (!input.found) {
    factLine = `Absent in the first ${input.datasetSize.toLocaleString("en-US")} digits`;
  } else if (input.firstPosition !== null) {
    factLine = `First appears at digit ${input.firstPosition.toLocaleString("en-US")}`;
  } else if (region) {
    factLine = `First appears at row ${region.matchRow + 1}, column ${region.matchCol + 1}`;
  } else {
    factLine = `First appears at digit ${p}`;
  }

  const countLine = input.found
    ? (input.count === 1 ? "Found once" : `Found ${count} times`)
    : "Not found";

  return {
    eyebrow: eyebrow(input),
    headline,
    subline,
    odds,
    thing: THINGS[input.mode],
    tierLabel: input.tier === "gold" ? "Legendary" : input.tier === "silver" ? "Rare" : input.tier === "aurora" ? "Lucky" : "Twilight",
    factLine,
    dedicationPill: input.dedication ? `For ${input.dedication}` : "",
    quote,
    finePrint: FINE_PRINT,
    oneIn: n,
    countLine,
  };
}

/** One-line summary shown beneath a preview. */
export function previewLine(input: WishCardInput, copy: WishCopy): string {
  const detail = input.tier === "gold" || input.tier === "silver"
    ? `1 in ${copy.oneIn} chance`
    : copy.countLine;
  return `${copy.tierLabel} card · ${detail}`;
}

/** Latin-only dedication sanitiser. Returns the removed flag for the hint. */
export function sanitizeDedication(raw: string): { value: string; removed: boolean } {
  const allowed = /[A-Za-zÀ-ÖØ-öø-ÿ0-9 .’&,\-]/g;
  const kept = raw.match(allowed)?.join("") ?? "";
  const collapsed = kept.replace(/\s+/g, " ").trim();
  const value = [...collapsed].slice(0, 24).join("");
  return { value, removed: kept !== raw || collapsed !== kept || value !== collapsed };
}
