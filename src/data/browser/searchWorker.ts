/**
 * Stage 6: search Web Worker.
 *
 * Owns the WASM engine, the on-demand chunk loader and the IndexedDB cache.
 * The main thread sends jobs; this worker streams progress and returns the
 * exact server-shaped DTOs. All heavy work (download, SHA-256, WASM scans)
 * happens here so the UI thread never blocks.
 */
/// <reference lib="webworker" />

import initWasm, { PiEngine } from "../../generated/pi-wasm/pi_wasm.js";
import { ChunkLoader, ChunkIntegrityError } from "./chunkLoader";
import { chunkForPosition, chunksForRange, type WebDatasetManifest } from "./manifest";
import { cachedFetcher, clearChunkCache, chunkCacheStatus } from "./chunkCache";
import { mapLimit } from "./parallel";
import {
  dateSequences,
  datesDto,
  DEFAULT_POSITION_CAP,
  DEFAULT_MATCH_CAP,
  exactDto,
  isValidDate,
  lettersDto,
  MAX_QUERY_LENGTH,
  patternDto,
  sanitizeDigits,
  statsDto,
  type CoreExact,
  type CoreLetters,
  type CorePattern,
  type CoreStats,
} from "./dto";
import type {
  WorkerRequest,
  WorkerResponse,
} from "./workerProtocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let engine: PiEngine | null = null;
let manifest: WebDatasetManifest | null = null;
let loader: ChunkLoader | null = null;
/** Job ids explicitly cancelled by the main thread. */
const cancelled = new Set<number>();
/** Currently executing job (one heavy search at a time). */
let activeJob: number | null = null;
/** Only these kinds are "heavy" — light window/sample reads must not cancel a search. */
const HEAVY_KINDS = new Set(["exact", "letters", "dates", "pattern", "stats"]);

/**
 * Chunks to fetch/verify in flight at once. The old sequential loop paid 100
 * separate fetch + SHA-256 + IndexedDB round trips for a cold 1B search; eight
 * concurrent workers cut that to ~13 rounds without opening 100 sockets.
 */
const CHUNK_LOAD_CONCURRENCY = 8;

class JobCancelled extends Error {
  constructor() {
    super("search cancelled");
    this.name = "JobCancelled";
  }
}

function post(msg: WorkerResponse): void {
  ctx.postMessage(msg);
}

function progress(id: number, checked: number, total: number): void {
  post({ type: "progress", id, checked, total });
}

function throwIfCancelled(id: number): void {
  if (cancelled.has(id)) throw new JobCancelled();
}

/**
 * Ensure a set of chunks is resident in the engine, streaming progress.
 * Verified bytes come from the IndexedDB→network ChunkLoader, then are pushed
 * into WASM (which re-verifies SHA-256 — defence in depth).
 */
async function ensureChunks(indices: number[], id: number): Promise<void> {
  if (!engine || !loader || !manifest) throw new Error("worker not initialised");
  const total = manifest.totalDigits;
  // Only missing chunks need work. Chunks already resident in WASM are reused
  // across searches, so repeat searches skip this entirely.
  const missing = indices.filter((index) => !engine!.has_chunk(index));
  let done = indices.length - missing.length;

  await mapLimit(missing, CHUNK_LOAD_CONCURRENCY, async (index) => {
    throwIfCancelled(id);
    const bytes = await loader!.loadChunk(index);
    throwIfCancelled(id);
    // WASM re-verifies SHA-256 (defence in depth). cachedFetcher has already
    // persisted verified bytes to IndexedDB, so no second write is needed.
    engine!.set_chunk(index, bytes);
    done += manifest!.chunks[index]?.digits ?? manifest!.chunkDigits;
    progress(id, Math.min(done, total), total);
  });
}

async function allChunkIndices(): Promise<number[]> {
  if (!manifest) throw new Error("worker not initialised");
  return manifest.chunks.map((c) => c.index);
}

/* ------------------------------- job handlers ------------------------------- */

async function runExact(id: number, payload: unknown): Promise<unknown> {
  if (!engine) throw new Error("worker not initialised");
  const body = payload as { query: string; position_cap?: number };
  const { query, removed } = sanitizeDigits(body.query);
  if (removed) throw new Error(`query contains non-digit characters: ${removed}`);
  if (!query) throw new Error("query is empty after removing separators");
  if (query.length > MAX_QUERY_LENGTH) throw new Error("query is longer than the 20-digit cap");
  const cap = Math.min(body.position_cap ?? DEFAULT_POSITION_CAP, DEFAULT_POSITION_CAP);
  await ensureChunks(await allChunkIndices(), id);
  throwIfCancelled(id);
  const core = JSON.parse(engine.search_exact(query, cap)) as CoreExact;
  let prefix: [number, number] = [0, 0];
  if (core.total === 0 && query.length > 1) {
    const p = JSON.parse(engine.longest_existing_prefix(query)) as [number, number] | null;
    if (p) prefix = [Number(p[0]), Number(p[1])];
  }
  return exactDto(query, core, cap, prefix);
}

async function runLetters(id: number, payload: unknown): Promise<unknown> {
  if (!engine) throw new Error("worker not initialised");
  const { word: rawWord } = payload as { word: string };
  await ensureChunks(await allChunkIndices(), id);
  throwIfCancelled(id);
  // The WASM helper expects an already-uppercased A-Z word; TS normalizer is
  // the exact port of Rust normalize_word used by the server.
  const { normalizeWord } = await import("../../engine/lettersSearch");
  const { word } = normalizeWord(rawWord);
  if (!word) throw new Error("word contains no letters");
  const core = JSON.parse(engine.search_letters(word, 200_000)) as CoreLetters;
  return lettersDto(rawWord, core);
}

async function runDates(id: number, payload: unknown): Promise<unknown> {
  if (!engine) throw new Error("worker not initialised");
  const { year, month, day } = payload as { year: number; month: number; day: number };
  if (!isValidDate(year, month, day)) {
    throw new Error(`invalid date: ${year}-${month}-${day}`);
  }
  await ensureChunks(await allChunkIndices(), id);
  const rows = dateSequences(year, month, day).map((seq) => {
    const core = JSON.parse(engine!.search_exact(seq.sequence, 10_000)) as CoreExact;
    let prefix: [number, number] = [0, 0];
    if (core.total === 0) {
      const p = JSON.parse(engine!.longest_existing_prefix(seq.sequence)) as [number, number] | null;
      if (p) prefix = [Number(p[0]), Number(p[1])];
    }
    return { id: seq.id, label: seq.label, sequence: seq.sequence, result: core, prefix };
  });
  throwIfCancelled(id);
  return datesDto(year, month, day, rows);
}

async function runPattern(id: number, payload: unknown): Promise<unknown> {
  if (!engine) throw new Error("worker not initialised");
  const spec = payload as {
    rows: number;
    cols: number;
    cells: number[];
    colour_mode: boolean;
    field_cols: number;
    match_cap?: number;
  };
  const valueCap = spec.colour_mode ? 9 : 1;
  let constrained = 0;
  for (const v of spec.cells) {
    if (v === -1) continue;
    if (v < 0 || v > valueCap) throw new Error(`cell value ${v} out of range`);
    constrained += 1;
  }
  if (constrained < 2) throw new Error("at least 2 constrained cells are required");
  const cap = Math.min(spec.match_cap ?? DEFAULT_MATCH_CAP, DEFAULT_MATCH_CAP);
  await ensureChunks(await allChunkIndices(), id);
  throwIfCancelled(id);
  const specJson = JSON.stringify({
    rows: spec.rows,
    cols: spec.cols,
    cells: spec.cells,
    colour_mode: spec.colour_mode,
  });
  const core = JSON.parse(
    engine.search_pattern(specJson, BigInt(spec.field_cols), cap),
  ) as CorePattern;
  return patternDto(core, spec, constrained);
}

async function runStats(id: number): Promise<unknown> {
  if (!engine) throw new Error("worker not initialised");
  await ensureChunks(await allChunkIndices(), id);
  throwIfCancelled(id);
  return statsDto(JSON.parse(engine.compute_stats()) as CoreStats);
}

async function runWindow(id: number, payload: unknown): Promise<unknown> {
  if (!engine || !manifest) throw new Error("worker not initialised");
  const { start, end } = payload as { start: number; end: number };
  await ensureChunks(chunksForRange(manifest, start, end), id);
  throwIfCancelled(id);
  return { first_position: start, digits: engine.get_window(BigInt(start), BigInt(end)) };
}

async function runSamples(id: number, payload: unknown): Promise<unknown> {
  if (!engine || !manifest) throw new Error("worker not initialised");
  const { count } = payload as { count: number };
  const n = Math.max(1, Math.min(count, manifest.totalDigits));
  const positions: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const frac = n === 1 ? 0.5 : i / (n - 1);
    positions.push(Math.min(manifest.totalDigits, Math.max(1, Math.round(1 + frac * (manifest.totalDigits - 1)))));
  }
  // Load the (usually few) owning chunks, streaming progress.
  const needed = [...new Set(positions.map((p) => chunkForPosition(manifest!, p)))].sort((a, b) => a - b);
  await ensureChunks(needed, id);
  throwIfCancelled(id);
  const samples = positions.map((position) => ({
    position,
    digit: engine!.get_digit(BigInt(position)),
  }));
  return { total_digits: manifest.totalDigits, samples };
}

const handlers: Record<string, (id: number, payload: unknown) => Promise<unknown>> = {
  exact: runExact,
  letters: runLetters,
  dates: runDates,
  pattern: runPattern,
  stats: runStats,
  window: runWindow,
  samples: runSamples,
};

async function runJob(id: number, kind: string, payload: unknown, requestId?: number): Promise<void> {
  if (HEAVY_KINDS.has(kind)) activeJob = id;
  try {
    const handler = handlers[kind];
    if (!handler) throw new Error(`unknown job kind: ${kind}`);
    const result = await handler(id, payload);
    if (cancelled.has(id)) throw new JobCancelled();
    post({ type: "result", id, requestId, result });
  } catch (err) {
    const message =
      err instanceof JobCancelled
        ? "cancelled"
        : err instanceof ChunkIntegrityError
          ? `dataset integrity failure: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
    post({ type: "error", id, requestId, error: message });
  } finally {
    cancelled.delete(id);
    if (activeJob === id) activeJob = null;
  }
}

/* ------------------------------ message loop ------------------------------ */

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "init": {
        await initWasm();
        manifest = msg.webManifest;
        engine = new PiEngine(msg.coreManifestJson);
        // Workers resolve relative URLs against their own script URL, so the
        // client supplies an absolute base URL. IndexedDB is checked first;
        // SHA-256 verification still happens inside ChunkLoader.
        const networkFetch = async (chunk: { file: string }, signal: AbortSignal): Promise<ArrayBuffer> => {
          const res = await fetch(`${msg.baseUrl}${chunk.file}`, { signal, cache: "force-cache" });
          if (!res.ok) throw new Error(`chunk fetch failed: HTTP ${res.status}`);
          return res.arrayBuffer();
        };
        loader = new ChunkLoader({
          manifest,
          fetcher: cachedFetcher(networkFetch, manifest.datasetId),
        });
        post({
          type: "ready",
          requestId: msg.requestId,
          totalDigits: Number(engine.total_digits),
          chunkCount: engine.chunk_count,
        });
        break;
      }
      case "job": {
        // One heavy search per tab: cancel any previous heavy job before a new
        // one starts. Light window/sample reads run concurrently.
        if (HEAVY_KINDS.has(msg.kind) && activeJob !== null && activeJob !== msg.id) {
          cancelled.add(activeJob);
        }
        void runJob(msg.id, msg.kind, msg.payload, msg.requestId);
        break;
      }
      case "cancel": {
        cancelled.add(msg.id);
        loader?.cancelAll();
        break;
      }
      case "clearCache": {
        await clearChunkCache();
        if (msg.requestId !== undefined) post({ type: "ack", requestId: msg.requestId });
        break;
      }
      case "storageStatus": {
        post({ type: "storageStatus", requestId: msg.requestId, status: await chunkCacheStatus() });
        break;
      }
      case "dispose": {
        engine?.free();
        engine = null;
        loader?.clear();
        loader = null;
        break;
      }
    }
  } catch (err) {
    post({ type: "fatal", error: err instanceof Error ? err.message : String(err) });
  }
};
