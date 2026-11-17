/**
 * Palette for the Colour Explorer: ten visually distinct hues.
 * Labels are colour-blind-friendly textual tags (never colour alone).
 */

export interface PaletteEntry {
  /** Digit this colour represents. */
  digit: number;
  name: string;
  /** CSS colour for dark theme. */
  dark: string;
  /** CSS colour for light theme. */
  light: string;
  /** Short textual symbol for accessibility. */
  symbol: string;
}

export const PALETTE: PaletteEntry[] = [
  { digit: 0, name: "Ink",    dark: "#23181f", light: "#f2eef4", symbol: "0" },
  { digit: 1, name: "Teal",   dark: "#61e6c1", light: "#0a7d67", symbol: "1" },
  { digit: 2, name: "Sky",    dark: "#65bceb", light: "#22639b", symbol: "2" },
  { digit: 3, name: "Violet", dark: "#a78bfa", light: "#5b3fa8", symbol: "3" },
  { digit: 4, name: "Rose",   dark: "#f0788c", light: "#a13047", symbol: "4" },
  { digit: 5, name: "Amber",  dark: "#e7bd72", light: "#8a5f14", symbol: "5" },
  { digit: 6, name: "Lime",   dark: "#a3d977", light: "#46661f", symbol: "6" },
  { digit: 7, name: "Coral",  dark: "#ef8354", light: "#99401a", symbol: "7" },
  { digit: 8, name: "Mint",   dark: "#7fe0d4", light: "#0f6f66", symbol: "8" },
  { digit: 9, name: "Slate",  dark: "#8fa3b5", light: "#3c5064", symbol: "9" },
];

/** Resolved colour for a digit honouring the active theme. */
export function colourFor(digit: number, themeIsLight: boolean): string {
  const p = PALETTE[((digit % 10) + 10) % 10];
  return themeIsLight ? p.light : p.dark;
}

export const SHAPE_INK = { black: "#0a0d10", white: "#f1f5f4" };
export const SHAPE_INK_LIGHT = { black: "#0a0d10", white: "#ffffff" };
