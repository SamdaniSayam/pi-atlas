/** Exact collectible tier palettes. The card ignores the app's live theme. */
import type { WishTier } from "./types";

export interface TierTheme {
  bg0: string;
  bg1: string;
  glow: string;
  glow2: string;
  foil: string[];
  text: string;
  dim: string;
  accent: string;
  pillText: string;
}

export const THEMES: Record<WishTier, TierTheme> = {
  gold: {
    bg0: "#0D0A05", bg1: "#1C1307", glow: "#FFC83D", glow2: "#FF8A3D",
    foil: ["#FFF3B0", "#FFD24D", "#E8A317", "#FFF0A8", "#C98A0B", "#FFE27A"],
    text: "#FFF6DC", dim: "#E9D5A1", accent: "#FFD24D", pillText: "#2A1B02",
  },
  silver: {
    bg0: "#080B12", bg1: "#131A29", glow: "#9FB4FF", glow2: "#7DD3FC",
    foil: ["#FFFFFF", "#CBD5E1", "#8FA3C0", "#F1F5F9", "#94A3B8", "#E2E8F0"],
    text: "#F4F7FC", dim: "#B6C2D6", accent: "#CBD5E1", pillText: "#0B1220",
  },
  aurora: {
    bg0: "#07110F", bg1: "#0B1F1B", glow: "#5EEAD4", glow2: "#A78BFA",
    foil: ["#5EEAD4", "#60A5FA", "#A78BFA", "#5EEAD4"],
    text: "#ECFDF8", dim: "#A9CFC6", accent: "#5EEAD4", pillText: "#04201C",
  },
  twilight: {
    bg0: "#0B0A1A", bg1: "#1B1237", glow: "#8B5CF6", glow2: "#FF9E7A",
    foil: ["#C4B5FD", "#A78BFA", "#FFB38A", "#C4B5FD"],
    text: "#F3F0FF", dim: "#B9B2D9", accent: "#C4B5FD", pillText: "#140E2B",
  },
};

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
