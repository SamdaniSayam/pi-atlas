/** Digit statistics engine (FR-08). */
import { CHI_SQUARE_95_DF9 } from "../constants";

export interface DigitStats {
  counts: number[];
  expected: number;
  stdDev: number;
  chiSquare: number;
  degreesOfFreedom: number;
  criticalValue95: number;
  passesAt95: boolean;
  maxDeviationPercent: number;
}

export function computeDigitStats(digits: string): DigitStats {
  const total = digits.length;
  const counts = new Array<number>(10).fill(0);
  for (let i = 0; i < total; i += 1) {
    const digit = digits.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) {
      throw new Error(`computeDigitStats: non-digit character at index ${i}`);
    }
    counts[digit] += 1;
  }
  // Statistics must follow the data actually passed in; the 2M constant is
  // only a test fixture and is wrong for the 1B runtime dataset.
  const expected = total / 10;
  const stdDev = Math.sqrt(total * 0.1 * 0.9);
  let chi = 0;
  if (expected > 0) {
    for (const c of counts) {
      const d = c - expected;
      chi += (d * d) / expected;
    }
  }
  const maxDeviationPercent =
    expected > 0
      ? Math.max(...counts.map((c) => Math.abs((c - expected) / expected) * 100))
      : 0;
  return {
    counts,
    expected,
    stdDev,
    chiSquare: chi,
    degreesOfFreedom: 9,
    criticalValue95: CHI_SQUARE_95_DF9,
    passesAt95: chi <= CHI_SQUARE_95_DF9,
    maxDeviationPercent,
  };
}
