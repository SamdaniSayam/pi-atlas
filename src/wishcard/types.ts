/** Wish-card data contract. Built from the existing search result objects. */

export type WishFormat = "square" | "story" | "wide";
export type WishStyle = "night" | "paper";
export type WishMode = "digits" | "letters" | "pixels" | "shapes";

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
}

export interface WishOptions {
  format: WishFormat;
  style: WishStyle;
  hideQuery: boolean;
}

export interface WishCopy {
  eyebrow: string;
  headline: string;
  subline: string;
  thing: string;
}

export const DEFAULT_WISH_OPTIONS: WishOptions = {
  format: "square",
  style: "night",
  hideQuery: false,
};
