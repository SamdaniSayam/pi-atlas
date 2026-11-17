/**
 * Typed client for the π Atlas search engine.
 *
 * Stage 7: the production transport is a LOCAL WASM engine running in a Web
 * Worker, served as static files from GitHub Pages. No HTTP backend, no running
 * API server and no paid service. This module keeps the exact exported types
 * and function signatures of the former Rust-service client so every React
 * component and Zustand store stays unchanged.
 *
 * The legacy HTTP path is retained ONLY under Vitest (`MODE === "test"`) so the
 * existing integration tests that stub `fetch` at /api/v1 keep working. Vite
 * statically replaces the mode constant, so the branch is dead-code-eliminated
 * from production builds.
 */
import { localBackend } from "./browser/localBackend";

declare global {
  interface Window {
    __PI_ATLAS_API__?: string;
  }
}

const USE_HTTP = import.meta.env.MODE === "test";

function httpBase(): string {
  const runtime =
    typeof window !== "undefined" && typeof window.__PI_ATLAS_API__ === "string"
      ? window.__PI_ATLAS_API__.trim()
      : "";
  const baked =
    typeof import.meta.env?.VITE_PI_ATLAS_API === "string" ? import.meta.env.VITE_PI_ATLAS_API.trim() : "";
  return (runtime || baked || "/api/v1").replace(/\/+$/, "");
}

/** @deprecated Local engine has no HTTP base URL; retained for compatibility. */
export const API_BASE = USE_HTTP ? httpBase() : "/local";

export class PiApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PiApiError";
    this.status = status;
    this.code = code;
  }
}

async function httpRequest<T>(
  path: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new PiApiError(0, "network", `Could not reach the π search service: ${(err as Error).message}`);
  }
  type ErrorBody = { error?: { code?: string; message?: string } };
  let data: ErrorBody | null = null;
  try {
    data = (await res.json()) as ErrorBody;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new PiApiError(
      res.status,
      data?.error?.code ?? "http_error",
      data?.error?.message ?? `Request failed (HTTP ${res.status}).`,
    );
  }
  return data as T;
}

/* ------------------------------ static endpoints ------------------------------ */

export interface ManifestInfo {
  format: string;
  totalDigits: number;
  chunkDigits: number;
  chunkCount: number;
  firstDigits: string;
  checkpoints: Array<{ query: string; firstPosition: number }>;
  sha256Packed: string;
}

export async function fetchManifest(): Promise<ManifestInfo> {
  if (USE_HTTP) {
    const raw = await httpRequest<{
      format: string;
      total_digits: number;
      chunk_digits: number;
      chunk_count: number;
      first_digits: string;
      checkpoints: Array<{ query: string; first_position: number }>;
      sha256_packed: string;
    }>("/manifest");
    return {
      format: raw.format,
      totalDigits: raw.total_digits,
      chunkDigits: raw.chunk_digits,
      chunkCount: raw.chunk_count,
      firstDigits: raw.first_digits,
      checkpoints: raw.checkpoints.map((c) => ({ query: c.query, firstPosition: c.first_position })),
      sha256Packed: raw.sha256_packed,
    };
  }
  await localBackend.init();
  return localBackend.getManifestInfo();
}

export async function fetchWindowDigits(start: number, end: number): Promise<string> {
  if (USE_HTTP) {
    const raw = await httpRequest<{ first_position: number; digits: string }>(
      `/window?start=${start}&end=${end}`,
    );
    return raw.digits;
  }
  return localBackend.fetchWindowDigits(start, end);
}

export interface DigitSample {
  position: number;
  digit: number;
}

export async function fetchSamples(count: number): Promise<{ totalDigits: number; samples: DigitSample[] }> {
  if (USE_HTTP) {
    const raw = await httpRequest<{ total_digits: number; samples: Array<{ position: number; digit: number }> }>(
      `/samples?count=${count}`,
    );
    return {
      totalDigits: raw.total_digits,
      samples: raw.samples.map((s) => ({ position: s.position, digit: s.digit })),
    };
  }
  const raw = await localBackend.fetchSamples(count);
  return { totalDigits: raw.total_digits, samples: raw.samples };
}

export interface DigitStats {
  counts: number[];
  totalDigits: number;
  chiSquare: number;
}

export async function fetchStats(): Promise<DigitStats> {
  if (USE_HTTP) {
    const raw = await httpRequest<{ counts: number[]; total_digits: number; chi_square: number }>("/stats");
    return { counts: raw.counts, totalDigits: raw.total_digits, chiSquare: raw.chi_square };
  }
  // localBackend already returns the camelCase DigitStats shape via statsDto.
  return localBackend.fetchStats();
}

/* ------------------------------ async jobs ------------------------------ */

export type JobStatus = "running" | "done" | "cancelled" | "failed" | "timeout";

export interface JobSnapshot<T> {
  id: number;
  kind: string;
  status: JobStatus;
  progress: { checked: number; total: number } | null;
  result: T | null;
  error: string | null;
  elapsedMs: number;
}

export type SearchResult = ExactResult | LettersResult | DatesResult | PatternResult;

export interface ExactResult {
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

export interface LettersFrame {
  frame: "A" | "B";
  positions: number[];
  total: number;
  capped: boolean;
}

export interface LettersResult {
  word: string;
  removed: string;
  pair_values: number[];
  frames: LettersFrame[];
  total: number;
  incomplete: boolean;
}

export interface DateRow {
  id: string;
  label: string;
  sequence: string;
  result: ExactResult;
}

export interface DatesResult {
  input: { year: number; month: number; day: number };
  rows: DateRow[];
  incomplete: boolean;
}

export interface PatternMatch {
  position: number;
  row: number;
  col: number;
}

export interface PatternResult {
  total: number;
  matches: PatternMatch[];
  capped: boolean;
  incomplete: boolean;
  anchors: number;
  constrained_cells: number;
  field_cols: number;
  rows: number;
  cols: number;
  colour_mode: boolean;
}

export type SubmitResponse<T> =
  | { cached: true; result: T }
  | { cached: false; jobId: number };

async function httpSubmit<T>(kind: string, body: unknown): Promise<SubmitResponse<T>> {
  const res = await fetch(`${API_BASE}/jobs/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | { job_id?: number; cached?: boolean; result?: T; error?: { code?: string; message?: string } }
    | null;
  if (!res.ok) {
    throw new PiApiError(res.status, data?.error?.code ?? "http_error", data?.error?.message ?? `Request failed (HTTP ${res.status}).`);
  }
  if (data?.cached) return { cached: true, result: data.result as T };
  if (!data || typeof data.job_id !== "number" || !Number.isInteger(data.job_id)) {
    throw new PiApiError(
      res.status,
      "malformed",
      "Search service returned neither a cached result nor a valid job_id.",
    );
  }
  return { cached: false, jobId: data.job_id };
}

export function submitExact(query: string, positionCap?: number) {
  const body = positionCap ? { query, position_cap: positionCap } : { query };
  return USE_HTTP ? httpSubmit<ExactResult>("exact", body) : localBackend.submit<ExactResult>("exact", body);
}

export function submitLetters(word: string) {
  return USE_HTTP
    ? httpSubmit<LettersResult>("letters", { word })
    : localBackend.submit<LettersResult>("letters", { word });
}

export function submitDates(year: number, month: number, day: number) {
  return USE_HTTP
    ? httpSubmit<DatesResult>("dates", { year, month, day })
    : localBackend.submit<DatesResult>("dates", { year, month, day });
}

export interface PatternSpecPayload {
  rows: number;
  cols: number;
  cells: number[];
  colour_mode: boolean;
  field_cols: number;
  match_cap?: number;
}

export function submitPattern(spec: PatternSpecPayload) {
  return USE_HTTP
    ? httpSubmit<PatternResult>("pattern", spec)
    : localBackend.submit<PatternResult>("pattern", spec as unknown as Record<string, unknown>);
}

export async function fetchJob<T extends SearchResult = SearchResult>(
  id: number,
  signal?: AbortSignal,
): Promise<JobSnapshot<T>> {
  if (USE_HTTP) {
    const raw = await httpRequest<{
      id: number;
      kind: string;
      status: JobStatus;
      progress: { checked: number; total: number } | null;
      result: T | null;
      error: string | null;
      elapsed_ms: number;
    }>(`/jobs/${id}`, { signal });
    return {
      id: raw.id,
      kind: raw.kind,
      status: raw.status,
      progress: raw.progress,
      result: raw.result,
      error: raw.error,
      elapsedMs: raw.elapsed_ms,
    };
  }
  return (await localBackend.fetchJob(id)) as JobSnapshot<T>;
}

export async function cancelJob(id: number): Promise<void> {
  if (USE_HTTP) await httpRequest(`/jobs/${id}/cancel`, { method: "POST", body: {} });
  else await localBackend.cancelJob(id);
}

export async function deleteJob(id: number): Promise<void> {
  if (USE_HTTP) await httpRequest(`/jobs/${id}`, { method: "DELETE" });
  else await localBackend.deleteJob(id);
}

/** Storage helpers used by the Settings screen (browser-only app). */
export const browserStorage = {
  status: () => localBackend.storageStatus(),
  clear: () => localBackend.clearCache(),
};

export interface PollOptions {
  signal?: AbortSignal;
  /** Initial delay between job snapshots (default 50 ms). */
  intervalMs?: number;
  /** Upper bound for the exponential backoff (default 400 ms). */
  maxIntervalMs?: number;
  onProgress?: (checked: number, total: number) => void;
}

export interface PollOutcome<T> {
  status: JobStatus;
  result: T | null;
  error: string | null;
  elapsedMs: number;
}

export async function pollJob<T extends SearchResult>(
  id: number,
  opts: PollOptions = {},
): Promise<PollOutcome<T>> {
  // Start responsive for short searches, then back off for long 1B scans so a
  // slow job does not burn CPU polling hundreds of times per second.
  let delay = opts.intervalMs ?? 50;
  const maxDelay = opts.maxIntervalMs ?? 400;
  for (;;) {
    const snap = await fetchJob<T>(id, opts.signal);
    if (snap.status !== "running") {
      return {
        status: snap.status,
        result: snap.result,
        error: snap.error,
        elapsedMs: snap.elapsedMs,
      };
    }
    if (snap.progress) opts.onProgress?.(snap.progress.checked, snap.progress.total);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(maxDelay, Math.ceil(delay * 1.5));
  }
}
