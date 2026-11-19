/** Wish-card data contract. Built from the existing search result objects. */

export type WishFormat = "square" | "story" | "wide";
export type WishStyle = "collectible" | "clean";
export type WishMode = "digits" | "letters" | "pixels" | "shapes";
export type WishTier = "gold" | "silver" | "aurora" | "twilight";
export type WishSubject =
  | "name" | "loved" | "birthday" | "lucky"
  | "word" | "number" | "shape" | "pattern";

export interface WishPatternRegion {
  rows: number;
  cols: number;
  values: number[];
  matchRow: number;
  matchCol: number;
}

export interface WishCardInput {
  mode: WishMode;
  found: boolean;
  /** Digits, letters, or the compact pattern string 'RxC:cells'. */
  query: string;
  /** Total matches (0 when not found). */
  count: number;
  /** 1-based decimal position of the first match, when known. */
  firstPosition: number | null;
  expected: number;
  /** log10 of the expected count; used in the not-found depth line. */
  expectedDepthLog10: number;
  /** Digits actually scanned, from the manifest. Never a hardcoded claim. */
  datasetSize: number;
  longestPrefix: { prefix: string; position: number } | null;
  /** Up to 30 characters around the first match. */
  context: { text: string; matchStart: number; matchLength: number } | null;
  /** Letters only. */
  frame?: "A" | "B";
  /** Pixels and shapes only. */
  pattern?: {
    rows: number;
    cols: number;
    cells: number[];
    kind: "color" | "shape";
    exact: boolean;
    /** Found only: matched area plus 2 cells margin, clipped at edges. */
    region?: WishPatternRegion;
  };
  /** Absolute deep link of this exact state. */
  shareUrl: string;
  hideQuery: boolean;
  /** Rarity derived from found + expected by `tierFor`. */
  tier: WishTier;
  /** What the search was about, chosen by the URL/mode or by the user. */
  subject: WishSubject;
  /** Short personal dedication; empty string when there is none. */
  dedication: string;
  /** Visual treatment; collectible is the default. */
  style: WishStyle;
  /** Dataset size in words, e.g. "1 billion digits" (from the manifest). */
  datasetWords: string;
}

export interface WishOptions {
  format: WishFormat;
  style: WishStyle;
  hideQuery: boolean;
}

export interface WishQuote {
  text: string;
  /** Attribution, present only for the one sourced quote. */
  by?: string;
}

export interface WishCopy {
  /** Tracked zone-2 label (also used as the small dialog eyebrow). */
  eyebrow: string;
  headline: string;
  subline: string;
  odds: string;
  thing: string;
  tierLabel: string;
  /** One understated line carrying the exact coordinate. */
  factLine: string;
  dedicationPill: string;
  quote: WishQuote;
  finePrint: string;
  /** "1 in 83 million"-style text for gold and silver, empty otherwise. */
  oneIn: string;
  /** Short count summary for the line under the preview. */
  countLine: string;
}

export const DEFAULT_WISH_OPTIONS: WishOptions = {
  format: "square",
  style: "collectible",
  hideQuery: false,
};

/** Subject phrases: S is the sentence-case form, s the lowercase form. */
export const SUBJECT_PHRASES: Record<WishSubject, { S: string; s: string }> = {
  name: { S: "Your name", s: "your name" },
  loved: { S: "Their name", s: "their name" },
  birthday: { S: "Your birthday", s: "your birthday" },
  lucky: { S: "Your lucky number", s: "your lucky number" },
  word: { S: "Your word", s: "your word" },
  number: { S: "Your number", s: "your number" },
  shape: { S: "Your shape", s: "your shape" },
  pattern: { S: "Your pattern", s: "your pattern" },
};

/** Chips offered for each mode; pixels and shapes deliberately have none. */
export const SUBJECT_CHIPS: Partial<Record<WishMode, Array<{ id: WishSubject; label: string }>>> = {
  letters: [
    { id: "name", label: "Name" },
    { id: "loved", label: "Someone I love" },
    { id: "word", label: "Word" },
  ],
  digits: [
    { id: "birthday", label: "Birthday" },
    { id: "lucky", label: "Lucky number" },
    { id: "number", label: "Number" },
  ],
};
