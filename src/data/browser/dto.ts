/**
 * Stage 7: convert lean pi-core WASM outputs into the EXACT DTO shapes the
 * Rust HTTP service (`service/crates/server/src/jobs_create.rs`) returns.
 * Keeping this translation in one audited file lets the entire React UI stay
 * unchanged while the transport moves from HTTP to a local WASM Worker.
 */
import { normalizeWord } from "../../engine/lettersSearch";

/* Lean pi-core structs (serde snake_case) as returned by the WASM engine. */
export interface CoreExact {
  total: number;
  positions: number[];
  truncated: boolean;
  incomplete: boolean;
}
export interface CoreLetterFrame {
  frame: "A" | "B";
  positions: number[];
  total: number;
  capped: boolean;
}
export interface CoreLetters {
  word: string;
  frames: CoreLetterFrame[];
  total: number;
  incomplete: boolean;
}
export interface CorePatternMatch {
  position: number;
  row: number;
  col: number;
}
export interface CorePattern {
  total: number;
  matches: CorePatternMatch[];
  anchors: number;
  capped: boolean;
  incomplete: boolean;
}
export interface CoreStats {
  counts: number[];
  total_digits: number;
  chi_square: number;
}

/* Server-shaped DTOs (mirror src/data/piApi.ts). */
export interface ServerExact {
  query: string;
  length: number;
  found: boolean;
  total: number;
  positions: number[];
  position_cap: number;
  truncated: boolean;
  incomplete: boolean;
  longest_existing_prefix: number;
  longest_existing_prefix_position: number;
}
export interface ServerLetters {
  word: string;
  removed: string;
  pair_values: number[];
  frames: CoreLetterFrame[];
  total: number;
  incomplete: boolean;
}
export interface ServerDateRow {
  id: string;
  label: string;
  sequence: string;
  result: ServerExact;
}
export interface ServerDates {
  input: { year: number; month: number; day: number };
  rows: ServerDateRow[];
  incomplete: boolean;
}
export interface ServerPattern {
  total: number;
  matches: CorePatternMatch[];
  capped: boolean;
  incomplete: boolean;
  anchors: number;
  constrained_cells: number;
  field_cols: number;
  rows: number;
  cols: number;
  colour_mode: boolean;
}

export const DEFAULT_POSITION_CAP = 200_000;
export const DATE_POSITION_CAP = 10_000;
export const DEFAULT_MATCH_CAP = 200_000;
export const MAX_WORD_LENGTH = 12;
export const MAX_QUERY_LENGTH = 20;

/** Exact DTO. The longest-prefix fields are supplied by the caller (the
 * worker computes them only when total === 0 and the server does the same). */
export function exactDto(
  query: string,
  core: CoreExact,
  positionCap: number,
  prefix: [number, number] = [0, 0],
): ServerExact {
  return {
    query,
    length: query.length,
    found: core.total > 0,
    total: core.total,
    positions: core.positions,
    position_cap: positionCap,
    truncated: core.truncated,
    incomplete: core.incomplete,
    longest_existing_prefix: prefix[0],
    longest_existing_prefix_position: prefix[1],
  };
}

/** Letters DTO. Uses the TS normalizer, an exact port of Rust `normalize_word`. */
export function lettersDto(rawWord: string, core: CoreLetters): ServerLetters {
  const { word, removed } = normalizeWord(rawWord);
  return {
    word,
    removed,
    pair_values: [...word].map((ch) => ch.charCodeAt(0) - 65),
    frames: core.frames,
    total: core.total,
    incomplete: core.incomplete,
  };
}

/** The six date formats in server order (Rust `normalize.rs::DATE_FORMATS`). */
export const DATE_FORMATS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "DDMMYYYY", label: "DDMMYYYY" },
  { id: "MMDDYYYY", label: "MMDDYYYY" },
  { id: "YYYYMMDD", label: "YYYYMMDD" },
  { id: "DDMMYY", label: "DDMMYY" },
  { id: "MMDDYY", label: "MMDDYY" },
  { id: "YYMMDD", label: "YYMMDD" },
];

const pad = (n: number, w: number): string => String(n).padStart(w, "0");

/** Encode a date into six digit sequences (first format wins on duplicates). */
export function dateSequences(y: number, m: number, d: number) {
  const yy = pad(y % 100, 2);
  const yyyy = pad(y, 4);
  const mm = pad(m, 2);
  const dd = pad(d, 2);
  const seqs = [dd + mm + yyyy, mm + dd + yyyy, yyyy + mm + dd, dd + mm + yy, mm + dd + yy, yy + mm + dd];
  return DATE_FORMATS.map((f, i) => ({ id: f.id, label: f.label, sequence: seqs[i] }));
}

export function isValidDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1];
}

/** Dates DTO: dedup sequences, per-row exact DTO, then server sort order. */
export function datesDto(
  y: number,
  m: number,
  d: number,
  rows: Array<{ id: string; label: string; sequence: string; result: CoreExact; prefix: [number, number] }>,
): ServerDates {
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    if (seen.has(row.sequence)) return false;
    seen.add(row.sequence);
    return true;
  });
  const out: ServerDateRow[] = unique.map((row) => ({
    id: row.id,
    label: row.label,
    sequence: row.sequence,
    result: exactDto(row.sequence, row.result, DATE_POSITION_CAP, row.prefix),
  }));
  // A cancelled/deadline-stopped format must not be cached as a complete
  // answer (the Rust service had this exact bug). Derive the flag from rows.
  const incomplete = out.some((row) => row.result.incomplete);
  out.sort((a, b) => {
    if (a.result.found !== b.result.found) return a.result.found ? -1 : 1;
    const pa = a.result.positions[0] ?? Number.MAX_SAFE_INTEGER;
    const pb = b.result.positions[0] ?? Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
  return { input: { year: y, month: m, day: d }, rows: out, incomplete };
}

/** Pattern DTO: adds the request echo fields the server preserves. */
export function patternDto(
  core: CorePattern,
  spec: { rows: number; cols: number; cells: number[]; colour_mode: boolean; field_cols: number },
  constrained: number,
): ServerPattern {
  return {
    total: core.total,
    matches: core.matches,
    capped: core.capped,
    incomplete: core.incomplete,
    anchors: core.anchors,
    constrained_cells: constrained,
    field_cols: spec.field_cols,
    rows: spec.rows,
    cols: spec.cols,
    colour_mode: spec.colour_mode,
  };
}

/** Stats DTO mapping snake_case → camelCase for the frontend contract. */
export function statsDto(core: CoreStats) {
  return {
    counts: core.counts.map(Number),
    totalDigits: Number(core.total_digits),
    chiSquare: core.chi_square,
  };
}

/** Sanitize a digit query exactly like Rust `sanitize_digits`. */
export function sanitizeDigits(raw: string): { query: string; removed: string } {
  const SILENT = new Set([",", " ", "\u{a0}", ".", "_", "-", "'", "\u{2019}", "\t"]);
  let query = "";
  let removed = "";
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") query += ch;
    else if (SILENT.has(ch)) continue;
    else removed += ch;
  }
  return { query, removed };
}
