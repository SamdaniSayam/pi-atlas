/** Digit statistics engine (FR-08). */
import { DATASET_SIZE, CHI_SQUARE_95_DF9 } from "../constants";

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
  const counts = new Array<number>(10).fill(0);
  for (let i = 0; i < digits.length; i += 1) {
    counts[digits.charCodeAt(i) - 48] += 1;
  }
  const expected = DATASET_SIZE / 10;
  const stdDev = Math.sqrt(DATASET_SIZE * 0.1 * 0.9);
  let chi = 0;
  for (const c of counts) {
    const d = c - expected;
    chi += (d * d) / expected;
  }
  const maxDeviationPercent = Math.max(
    ...counts.map((c) => Math.abs((c - expected) / expected) * 100),
  );
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
