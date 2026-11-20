/** Date → digit-sequence encodings (FR-03). */
import { searchDigits, type DigitsSearchResult } from "./digitsSearch";

export interface DateFormatSpec {
  id: string;
  label: string;
  encode: (y: number, m: number, d: number) => string;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

export const DATE_FORMATS: DateFormatSpec[] = [
  { id: "DDMMYYYY", label: "DDMMYYYY", encode: (y, m, d) => `${pad(d, 2)}${pad(m, 2)}${pad(y, 4)}` },
  { id: "MMDDYYYY", label: "MMDDYYYY", encode: (y, m, d) => `${pad(m, 2)}${pad(d, 2)}${pad(y, 4)}` },
  { id: "YYYYMMDD", label: "YYYYMMDD", encode: (y, m, d) => `${pad(y, 4)}${pad(m, 2)}${pad(d, 2)}` },
  { id: "DDMMYY", label: "DDMMYY", encode: (y, m, d) => `${pad(d, 2)}${pad(m, 2)}${pad(y % 100, 2)}` },
  { id: "MMDDYY", label: "MMDDYY", encode: (y, m, d) => `${pad(m, 2)}${pad(d, 2)}${pad(y % 100, 2)}` },
  { id: "YYMMDD", label: "YYMMDD", encode: (y, m, d) => `${pad(y % 100, 2)}${pad(m, 2)}${pad(d, 2)}` },
];

export function isValidDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1 || y > 9999) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1) return false;
  const daysInMonth = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= daysInMonth[m - 1];
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export interface DateSearchRow {
  spec: DateFormatSpec;
  sequence: string;
  result: DigitsSearchResult;
}

export interface DateSearchResult {
  rows: DateSearchRow[];
}

/** Run all six encodings; unique sequences deduplicated (first format wins). */
export function searchDate(
  digits: string,
  y: number,
  m: number,
  d: number,
): DateSearchResult {
  if (!isValidDate(y, m, d)) return { rows: [] };
  const seen = new Set<string>();
  const rows: DateSearchRow[] = [];
  for (const spec of DATE_FORMATS) {
    const sequence = spec.encode(y, m, d);
    if (seen.has(sequence)) continue;
    seen.add(sequence);
    rows.push({ spec, sequence, result: searchDigits(digits, sequence, 10_000) });
  }
  rows.sort((a, b) => {
    if (a.result.found !== b.result.found) return a.result.found ? -1 : 1;
    const pa = a.result.positions[0];
    const pb = b.result.positions[0];
    const safeA = Number.isFinite(pa) ? pa : Number.POSITIVE_INFINITY;
    const safeB = Number.isFinite(pb) ? pb : Number.POSITIVE_INFINITY;
    if (safeA !== safeB) return safeA - safeB;
    // Stable ordering for equal/absent positions: keep DATE_FORMATS order.
    return DATE_FORMATS.indexOf(a.spec) - DATE_FORMATS.indexOf(b.spec);
  });
  return { rows };
}
