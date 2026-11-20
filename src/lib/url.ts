/** URL state helpers (§33). URL is the source of truth for search configuration. */
import type { SearchMode } from "../state/useHistory";
import { CANONICAL_SITE_URL } from "./socialMetadata";
import {
  DEFAULT_PIXEL_WIDTH,
  MIN_PIXEL_WIDTH,
  MAX_PIXEL_WIDTH,
  PIXEL_WIDTH_STEP,
  MAX_PATTERN_ROWS,
  MAX_PATTERN_COLS,
} from "../constants";

export interface ExploreUrlState {
  mode: SearchMode;
  query: string;
  occurrence: number;
  frame: "A" | "B";
  /** Pattern cells as compact string "-1,3,-1,..." (colour) or "0,1,..." (shape). */
  pattern: number[] | null;
  patternRows: number;
  patternCols: number;
  exact: boolean;
  fieldWidth: number;
  /** Odds lab params. */
  colours?: number;
  oddsW?: number;
  oddsH?: number;
}

const MODES: SearchMode[] = ["digits", "dates", "letters", "colors", "shapes"];

export function parseExploreParams(search: URLSearchParams): ExploreUrlState {
  const rawMode = search.get("mode") ?? "";
  const mode: SearchMode = MODES.includes(rawMode as SearchMode)
    ? (rawMode as SearchMode)
    : "digits";
  const query = (search.get("q") ?? "").slice(0, 100);
  const occurrence = clampInt(search.get("occ"), 1, 1_000_000, 1) ?? 1;
  const frame = search.get("frame") === "B" ? "B" : "A";
  const pattern = parsePattern(search.get("p"));
  const patternRows = clampInt(search.get("pr"), 1, MAX_PATTERN_ROWS, 1) ?? 1;
  const patternCols = clampInt(search.get("pc"), 1, MAX_PATTERN_COLS, 1) ?? 1;
  const exact = search.get("exact") !== "0";
  const fieldWidth = clampFieldWidth(search.get("w"));
  const colours = clampInt(search.get("c"), 2, 256, undefined);
  const oddsW = clampInt(search.get("ow"), 1, 64, undefined);
  const oddsH = clampInt(search.get("oh"), 1, 64, undefined);
  return {
    mode,
    query,
    occurrence,
    frame,
    pattern,
    patternRows,
    patternCols,
    exact,
    fieldWidth,
    colours,
    oddsW,
    oddsH,
  };
}

export function parsePattern(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return null;
    const nums = arr.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= -1 && v <= 9);
    if (nums.length === 0 || nums.length !== arr.length || nums.length > 36) return null;
    return nums;
  } catch {
    return null;
  }
}

export function clampFieldWidth(raw: string | null): number {
  const v = clampInt(raw, MIN_PIXEL_WIDTH, MAX_PIXEL_WIDTH, DEFAULT_PIXEL_WIDTH) ?? DEFAULT_PIXEL_WIDTH;
  const snapped = Math.round(v / PIXEL_WIDTH_STEP) * PIXEL_WIDTH_STEP;
  return Math.min(MAX_PIXEL_WIDTH, Math.max(MIN_PIXEL_WIDTH, snapped));
}

function clampInt(
  raw: string | null,
  min: number,
  max: number,
  fallback: number | undefined,
): number | undefined {
  // Absent optional parameters must stay absent: coercing them to `min` turns
  // `?q=12` into a state with colours=2/oddsW=1/oddsH=1 and pollutes share URLs.
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function serializeExplore(state: Partial<ExploreUrlState>): string {
  const p = new URLSearchParams();
  if (state.mode && state.mode !== "digits") p.set("mode", state.mode);
  if (state.query) p.set("q", state.query.slice(0, 100));
  if (state.occurrence && state.occurrence > 1) p.set("occ", String(state.occurrence));
  if (state.frame === "B") p.set("frame", "B");
  if (state.pattern) p.set("p", JSON.stringify(state.pattern));
  if (state.patternRows && state.patternRows > 1) p.set("pr", String(state.patternRows));
  if (state.patternCols && state.patternCols > 1) p.set("pc", String(state.patternCols));
  if (state.exact === false) p.set("exact", "0");
  if (state.fieldWidth && state.fieldWidth !== DEFAULT_PIXEL_WIDTH) p.set("w", String(state.fieldWidth));
  if (state.colours) p.set("c", String(state.colours));
  if (state.oddsW) p.set("ow", String(state.oddsW));
  if (state.oddsH) p.set("oh", String(state.oddsH));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Build a shareable absolute URL for a search state. */
export function buildShareUrl(pathname: string, state: Partial<ExploreUrlState>): string {
  // Never emit a non-HTTP(S) or `null` origin (file://, data:, extension pages):
  // those links cannot be opened by a QR scan or another device.
  const loc = typeof window !== "undefined" ? window.location : null;
  const httpOrigin =
    loc && (loc.protocol === "https:" || loc.protocol === "http:")
      ? loc.origin + loc.pathname
      : CANONICAL_SITE_URL;
  return `${httpOrigin}#${pathname}${serializeExplore(state)}`;
}
