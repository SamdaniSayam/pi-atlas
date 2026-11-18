/**
 * Exact copy deck. Every string is deterministic for a search and every pool
 * uses the same FNV-1a index with its own salt (h = headline, s = subline,
 * q = quote). All numbers come from the result; no invented facts.
 */
import { formatDepth } from "./depth";
import { oneIn } from "./tiers";
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

/** Compact form used in the clean-style header. */
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

export const HEADLINES: Record<WishCardInput["tier"], readonly string[]> = {
  gold: [
    "{S} is a legend in π.",
    "Wow. {S} is in π.",
    "{S} beat the odds.",
    "A truly rare find.",
    "π just got personal.",
  ],
  silver: [
    "{S} is hiding in π.",
    "Rare find: {s} is in π.",
    "You found {s}!",
    "A rare spot in π.",
    "{S} was in there all along.",
  ],
  aurora: [
    "{S} is in π!",
    "Found it: {s}.",
    "{S} lives in π.",
    "Spotted in the digits!",
    "Pin dropped in π.",
  ],
  twilight: [
    "{S} is still out there.",
    "Beyond the horizon.",
    "Hiding deeper in π.",
    "Too rare for this stretch.",
    "Not found. You’re still special.",
  ],
};

export const SUBLINES: Record<WishCardInput["tier"], readonly string[]> = {
  gold: [
    "It was a long shot across {D}, and you landed it.",
    "Hardly anything this rare turns up in {D}. This did.",
    "You went looking through {D} and came back with a treasure.",
  ],
  silver: [
    "A rare find in {D}. Take a moment to enjoy it.",
    "Not every search lands. Yours did, in {D}.",
    "Hidden in {D}, and you spotted it.",
  ],
  aurora: [
    "Found in {D}. A small win worth sharing.",
    "{D} searched, and yours showed up.",
    "Endless digits, and there it is.",
  ],
  twilight: [
    "We searched {D} and it didn’t turn up. That only makes it rarer.",
    "It isn’t in the first {D}. π never ends, so it may be waiting further out.",
    "Not in {D}. Rare questions come from curious people.",
  ],
};

export const QUOTES: Record<WishCardInput["tier"], readonly WishQuote[]> = {
  gold: [
    { text: "Infinity has room for everything. You found a rare corner of it." },
    { text: "The digits never end, and you still found a rare one." },
    { text: "An irrational number never repeats. Moments like this hardly ever do." },
    { text: "No cycle, no pattern, no end. And yet, there it was." },
    { text: "It was there all along. You were the one who looked." },
    { text: "Against the odds, inside a number that never ends." },
    { text: "Irrational and endless, and you still found your place in it." },
    { text: "The odds were thin and the search was brave." },
    { text: "One digit after another, forever. And you spotted the gem." },
    { text: "Looking into infinity takes nerve. Finding this takes luck." },
    { text: "Rare is what infinity looks like up close." },
    { text: "Curiosity beat the odds today." },
  ],
  silver: [
    { text: "A little luck, a lot of infinity." },
    { text: "π never ends, and neither does the thrill of finding something." },
    { text: "Rare, but real: it was in the digits all along." },
    { text: "Every digit is a doorway. You opened a good one." },
    { text: "Hard-to-find patterns are the best kind to find." },
    { text: "Randomness looks like chaos until something familiar appears." },
    { text: "In a number with no end, you found a landmark." },
    { text: "Wonder is just curiosity with good timing." },
    { text: "The search was yours. The luck was shared with infinity." },
    { text: "Mathematics rewards the curious." },
    { text: "Some patterns hide in plain sight. You looked." },
    { text: "Small odds, big smile." },
  ],
  aurora: [
    { text: "Even in infinity, familiar things appear." },
    { text: "Every great search starts with one small number." },
    { text: "π never repeats, yet your number turned up." },
    { text: "Endless digits, and still a friendly face." },
    { text: "Curiosity is the shortest path through infinity." },
    { text: "You asked the digits a question. The digits answered." },
    { text: "A number that never ends still has room for yours." },
    { text: "Look closely at infinity and small wonders appear." },
    { text: "Today’s tiny discovery: it’s in π." },
    { text: "Go on, search another. Infinity doesn’t mind." },
    { text: "Found it. Now imagine what else is out there." },
    { text: "Math is better when it’s personal." },
  ],
  twilight: [
    { text: "Not in this stretch of digits. π keeps going, and so can you." },
    { text: "π never ends. Maybe yours is just further out." },
    { text: "Rare isn’t missing. It may simply be further out." },
    { text: "Some things need more digits than one search can hold." },
    { text: "You asked a question big enough to need endless digits." },
    { text: "Not found yet. Infinity is patient." },
    { text: "No search can reach the end of π. That is the beauty of it." },
    { text: "The horizon moves as you walk toward it. Keep going." },
    { text: "Absent from this stretch, not necessarily from π." },
    { text: "What isn’t here yet is still worth looking for." },
    { text: "We must know. We will know.", by: "— David Hilbert, 1930" },
    { text: "Even an endless number keeps some surprises for later." },
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

/** Pill text. Kept as `eyebrow` for older callers of the copy API. */
export function eyebrow(input: WishCardInput): string {
  if (input.tier === "gold") return "LEGENDARY FIND";
  if (input.tier === "silver") return "RARE FIND";
  if (input.tier === "aurora") return "LUCKY FIND";
  const prefix = input.longestPrefix?.prefix.length ?? 0;
  return prefix >= input.query.length - 1 ? "SO CLOSE" : "BEYOND THE HORIZON";
}

/** Build all card copy from the input; pure and deterministic. */
export function pickCopy(input: WishCardInput): WishCopy {
  const { S, s } = SUBJECT_PHRASES[input.subject];
  const key = `${input.mode}|${input.query}|${input.tier}|${input.subject}`;
  const D = input.datasetWords || datasetWordsWithDigits(input.datasetSize);
  const region = input.pattern?.region;
  const p = (input.firstPosition ?? input.longestPrefix?.position ?? 0).toLocaleString("en-US");
  const r = region ? String(region.matchRow + 1) : "—";
  const c = region ? String(region.matchCol + 1) : "—";
  const count = countLabel(input.count);
  const n = input.tier === "gold" || input.tier === "silver" ? oneIn(input.expected) : "";
  const k = formatDepth(input.expectedDepthLog10);
  const prefix = input.hideQuery ? s : input.longestPrefix?.prefix ?? s;
  const tokens = { S, s, D, p, count, n, k, r, c, prefix };

  const headline = substitute(pick(HEADLINES[input.tier], key, "h"), tokens);
  const subline = substitute(pick(SUBLINES[input.tier], key, "s"), tokens);
  const quote = pick(QUOTES[input.tier], key, "q");

  let odds: string;
  if (input.tier === "gold" || input.tier === "silver") {
    odds = "Only a 1 in {n} chance it would appear in {D}.";
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

  const collectorTag = input.found
    ? `Nº ${p}`
    : `BEYOND DIGIT ${input.datasetSize.toLocaleString("en-US")}`;
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
    collectorTag,
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
