/**
 * Typed client for the π Atlas search service (Rust, `service/`).
 *
 * The browser never holds the dataset: searches run server-side as async jobs
 * (`POST /api/v1/jobs/*` → poll `/jobs/{id}`), and digit windows are fetched on
 * demand (`GET /api/v1/window`). All positions are 1-based decimal positions.
 */

/**
 * API root resolution (first match wins):
 *   1. `window.__PI_ATLAS_API__`  — runtime override (self-hosted deployments)
 *   2. `import.meta.env.VITE_PI_ATLAS_API` — baked in at build time. This is
 *      public endpoint configuration, never a secret.
 *   3. same-origin `/api/v1` — local development and `vite preview`, proxied
 *      to the Rust search service.
 *
 * Values are used verbatim (minus trailing slashes), e.g.
 *   VITE_PI_ATLAS_API=https://pi-atlas-api.example.com/api/v1
 */
declare global {
  interface Window {
    __PI_ATLAS_API__?: string;
  }
}

function resolveApiBase(): string {
  const runtime =
    typeof window !== "undefined" && typeof window.__PI_ATLAS_API__ === "string"
      ? window.__PI_ATLAS_API__.trim()
      : "";
  const baked =
    typeof import.meta.env?.VITE_PI_ATLAS_API === "string" ? import.meta.env.VITE_PI_ATLAS_API.trim() : "";
  const root = runtime || baked || "/api/v1";
  return root.replace(/\/+$/, "");
}

export const API_BASE = resolveApiBase();

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

async function request<T>(
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
    data = null; // non-JSON body (e.g. bare 404) — fall back to the status line
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

/** GET /manifest — dataset identity, size and integrity metadata. */
export async function fetchManifest(): Promise<ManifestInfo> {
  const raw = await request<{
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

/** GET /window?start=&end= — digits for 1-based inclusive [start, end]. */
export async function fetchWindowDigits(start: number, end: number): Promise<string> {
  const raw = await request<{ first_position: number; digits: string }>(
    `/window?start=${start}&end=${end}`,
  );
  return raw.digits;
}

export interface DigitSample {
  position: number;
  digit: number;
}

/** GET /samples?count= — evenly spread representative digits. */
export async function fetchSamples(count: number): Promise<{ totalDigits: number; samples: DigitSample[] }> {
  const raw = await request<{ total_digits: number; samples: Array<{ position: number; digit: number }> }>(
    `/samples?count=${count}`,
  );
  return {
    totalDigits: raw.total_digits,
    samples: raw.samples.map((s) => ({ position: s.position, digit: s.digit })),
  };
}

export interface DigitStats {
  counts: number[];
  totalDigits: number;
  chiSquare: number;
}

/** GET /stats — digit counts + chi-square over the whole dataset (cached server-side). */
export async function fetchStats(): Promise<DigitStats> {
  const raw = await request<{ counts: number[]; total_digits: number; chi_square: number }>("/stats");
  return { counts: raw.counts, totalDigits: raw.total_digits, chiSquare: raw.chi_square };
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

/** One of the four search payloads (server returns the full result JSON). */
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

async function submit<T>(kind: string, body: unknown): Promise<SubmitResponse<T>> {
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
  return { cached: false, jobId: data!.job_id! };
}

export function submitExact(query: string, positionCap?: number) {
  return submit<ExactResult>("exact", positionCap ? { query, position_cap: positionCap } : { query });
}

export function submitLetters(word: string) {
  return submit<LettersResult>("letters", { word });
}

export function submitDates(year: number, month: number, day: number) {
  return submit<DatesResult>("dates", { year, month, day });
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
  return submit<PatternResult>("pattern", spec);
}

/** GET /jobs/{id} — latest snapshot (progress while running). */
export async function fetchJob<T extends SearchResult = SearchResult>(
  id: number,
  signal?: AbortSignal,
): Promise<JobSnapshot<T>> {
  const raw = await request<{
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

/** POST /jobs/{id}/cancel — ask a running job to stop at its next chunk. */
export async function cancelJob(id: number): Promise<void> {
  await request(`/jobs/${id}/cancel`, { method: "POST", body: {} });
}

/** DELETE /jobs/{id} — drop a finished job (and its cache entry) server-side. */
export async function deleteJob(id: number): Promise<void> {
  await request(`/jobs/${id}`, { method: "DELETE" });
}

export interface PollOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  onProgress?: (checked: number, total: number) => void;
}

export interface PollOutcome<T> {
  status: JobStatus;
  result: T | null;
  error: string | null;
  elapsedMs: number;
}

/** Poll a job until it leaves `running`. Throws PiApiError on transport/HTTP errors. */
export async function pollJob<T extends SearchResult>(
  id: number,
  opts: PollOptions = {},
): Promise<PollOutcome<T>> {
  const interval = opts.intervalMs ?? 100;
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
    await new Promise((r) => setTimeout(r, interval));
  }
}
