/** Shared formatting helpers. */

const groupInt = new Intl.NumberFormat("en-US");

export function formatInt(n: number): string {
  return groupInt.format(n);
}

export function formatBig(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n < 10_000) return groupInt.format(Math.round(n));
  if (n < 1e9) return `${groupInt.format(Math.round(n))}`;
  return formatMagnitude(n);
}

/** Compact scientific-style magnitude: "3.9 × 10^8" or "10^24". */
export function formatMagnitude(n: number): string {
  if (n === 0) return "0";
  if (!Number.isFinite(n)) return "∞";
  const exp = Math.floor(Math.log10(Math.abs(n)));
  if (exp < 6) return groupInt.format(Math.round(n));
  const mant = n / 10 ** exp;
  const mantStr = mant.toFixed(2).replace(/\.?0+$/, "");
  if (exp <= 21) {
    return `${mantStr} × 10^${exp}`;
  }
  return `10^${exp}`;
}

/** One-in-X style probability string. */
export function formatOneIn(p: number): string {
  if (p <= 0) return "never";
  const inv = 1 / p;
  if (inv < 1000) return `1 in ${groupInt.format(Math.round(inv))}`;
  return `1 in ${formatMagnitude(inv)}`;
}

export function formatPercent(p: number, digits = 2): string {
  return `${(p * 100).toFixed(digits)}%`;
}

export type DifficultyLevel =
  | "very-common"
  | "likely"
  | "unlikely"
  | "practically-impossible";

export interface DifficultyInfo {
  level: DifficultyLevel;
  label: string;
  description: string;
}

/**
 * Difficulty category for a pattern with an expected number of matches
 * within the loaded dataset.
 */
export function difficultyFor(expectedMatches: number): DifficultyInfo {
  if (expectedMatches >= 1000) {
    return {
      level: "very-common",
      label: "Very common",
      description: "Thousands of matches are expected within the dataset.",
    };
  }
  if (expectedMatches >= 1) {
    return {
      level: "likely",
      label: "Likely",
      description: "At least one match is expected somewhere in the dataset.",
    };
  }
  if (expectedMatches >= 0.001) {
    return {
      level: "unlikely",
      label: "Unlikely",
      description:
        "A match would be lucky — fewer than one is expected in the dataset.",
    };
  }
  return {
    level: "practically-impossible",
    label: "Practically impossible",
    description:
      "The expected number of matches is astronomically small; do not expect to find this.",
  };
}

export function formatPosition(pos: number): string {
  return formatInt(pos);
}
