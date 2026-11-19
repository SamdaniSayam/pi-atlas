/**
 * Royal Observatory palettes. Flat heritage tones, no gradients or glow.
 * The card ignores the app's live theme and uses only these exact colours.
 */
import type { WishTier } from "./types";

export interface TierTheme {
  /** Card background. */
  bg: string;
  /** Architectural hairline and outer frame. */
  line: string;
  /** Primary ink. */
  text: string;
  /** Royal accent used for the tier label. */
  accent: string;
  /** Muted metadata. */
  dim: string;
}

export const THEMES: Record<WishTier, TierTheme> = {
  gold: {
    bg: "#0D0B0A", line: "#3A3124", text: "#F6F1E7",
    accent: "#D4AF6A", dim: "#A39784",
  },
  silver: {
    bg: "#0C1322", line: "#26344D", text: "#F1F5F9",
    accent: "#C7D2E2", dim: "#8E9DB5",
  },
  aurora: {
    bg: "#0A1D18", line: "#1F4238", text: "#F3EFE6",
    accent: "#C9B382", dim: "#8FA89E",
  },
  twilight: {
    bg: "#1B0E14", line: "#422533", text: "#F5EEF0",
    accent: "#D4A5A5", dim: "#A68992",
  },
};

/** Archival Ivory Parchment, the one refined light museum-print option. */
export const CLEAN_THEME: TierTheme = {
  bg: "#F5F0E6", line: "#D8CFC0", text: "#161412",
  accent: "#8C6B32", dim: "#5C554B",
};

/** Theme used by a card, independent of tier when the clean style is chosen. */
export function themeFor(tier: WishTier, style: "collectible" | "clean"): TierTheme {
  return style === "clean" ? CLEAN_THEME : THEMES[tier];
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
