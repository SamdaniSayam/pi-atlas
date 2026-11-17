/**
 * Stage 7: local backend implementing the Rust service's job semantics on top
 * of the search Worker. This is the only module `piApi.ts` needs to delegate
 * to; all React/state components keep their existing API contract.
 */
import { validateManifest, type WebDatasetManifest } from "./manifest";
import type { ChunkCacheStatus } from "./chunkCache";
import type {
  JobStatus,
  JobSnapshot,
  SubmitResponse,
} from "../piApi";
import type { WorkerJobKind, WorkerRequest, WorkerResponse } from "./workerProtocol";
import { normalizeWord } from "../../engine/lettersSearch";

/** Dataset root, relative to the app base URL. Override for the 1B deploy. */
function datasetRoot(): string {
  const raw =
    (typeof import.meta.env?.VITE_PI_DATASET_URL === "string"
      ? import.meta.env.VITE_PI_DATASET_URL
      : "") || "data/pi-2m/";
  const base = typeof document !== "undefined" ? document.baseURI : "/";
  return new URL(raw.replace(/\/+$/, "") + "/", base).href;
}

interface LocalJob {
  id: number;
  __key: string;
  kind: string;
  status: JobStatus;
  progress: { checked: number; total: number } | null;
  result: unknown | null;
  error: string | null;
  startedAt: number;
  elapsedMs: number;
  settledAt: number | null;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** Stable cache keys — identical to Rust `jobs_create.rs`. */
export function cacheKey(kind: string, body: Record<string, unknown>): string {
  switch (kind) {
    case "exact": {
      const cap = Math.min((body.position_cap as number) || 200_000, 200_000);
      return `exact:${body.query}:${cap}`;
    }
    case "letters":
      return `letters:${normalizeWord(String(body.word)).word}`;
    case "dates":
      return `dates:${body.year}:${body.month}:${body.day}`;
    case "pattern": {
      const cells = (body.cells as number[]).join(",");
      const cap = Math.min((body.match_cap as number) || 200_000, 200_000);
      return `pattern:${body.rows}:${body.cols}:${body.colour_mode}:${cells}:${body.field_cols}:${cap}`;
    }
    default:
      return `${kind}:${JSON.stringify(body)}`;
  }
}

/** True when a DTO (or any nested date row) reports a truncated/incomplete scan. */
function hasIncomplete(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const value = result as Record<string, unknown>;
  if (value.incomplete === true) return true;
  if (Array.isArray(value.rows)) {
    return value.rows.some((row) => hasIncomplete(row));
  }
  return false;
}

class LocalBackend {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<number, PendingCall>();
  private readonly jobs = new Map<number, LocalJob>();
  private readonly results = new Map<string, unknown>();
  private nextId = 1;
  private nextRequestId = 1;
  private manifest: WebDatasetManifest | null = null;
  private fatalError: string | null = null;

  /** Lazily start the worker, load manifests, and wait for WASM readiness. */
  init(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.doInit().catch((err) => {
      this.fatalError = err instanceof Error ? err.message : String(err);
      // Allow a later retry after a transient failure (e.g. manifest 404).
      this.ready = null;
      this.worker?.terminate();
      this.worker = null;
      throw err;
    });
    return this.ready;
  }

  private async doInit(): Promise<void> {
    const root = datasetRoot();
    const [webRes, coreRes] = await Promise.all([
      fetch(`${root}web-manifest.json`, { cache: "force-cache" }),
      fetch(`${root}core-manifest.json`, { cache: "force-cache" }),
    ]);
    if (!webRes.ok) throw new Error(`web-manifest.json unavailable (HTTP ${webRes.status})`);
    if (!coreRes.ok) throw new Error(`core-manifest.json unavailable (HTTP ${coreRes.status})`);
    const webManifest = validateManifest(await webRes.json());
    const coreManifestJson = await coreRes.text();
    this.manifest = webManifest;

    this.worker = new Worker(new URL("./searchWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handle(event.data);
    this.worker.onerror = (event) => {
      this.fatalError = event.message || "search worker crashed";
    };

    await this.call({
      type: "init",
      coreManifestJson,
      webManifest,
      // Resolve the manifest's relative baseUrl against the dataset root.
      baseUrl: new URL(webManifest.baseUrl.replace(/\/+$/, "") + "/", root).href,
    });
  }

  private call(message: WorkerRequest): Promise<unknown> {
    if (!this.worker) return Promise.reject(new Error("search worker not started"));
    const requestId = this.nextRequestId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker!.postMessage({ ...message, requestId });
    });
  }

  private handle(msg: WorkerResponse): void {
    if (msg.type === "progress") {
      const job = this.jobs.get(msg.id);
      if (job && job.status === "running") job.progress = { checked: msg.checked, total: msg.total };
      return;
    }
    if (msg.type === "result" || msg.type === "error") {
      const job = this.jobs.get(msg.id);
      if (job) {
        job.status =
          msg.type === "error" && msg.error === "cancelled"
            ? "cancelled"
            : msg.type === "error"
              ? "failed"
              : "done";
        job.result = msg.type === "result" ? msg.result : null;
        job.error = msg.type === "error" && msg.error !== "cancelled" ? msg.error : null;
        job.progress = null;
        job.elapsedMs = Date.now() - job.startedAt;
        job.settledAt = Date.now();
        // Never cache a partial result — a cancelled/deadline-stopped scan must
        // not become the permanent answer to an identical later query.
        if (job.status === "done" && !hasIncomplete(job.result)) {
          this.results.set(job.__key, job.result);
        }
      }
      this.settle(msg.requestId, msg.type === "result" ? msg.result : new Error(msg.error));
      return;
    }
    if (msg.type === "storageStatus" || msg.type === "ready" || msg.type === "ack") {
      this.settle(msg.requestId, msg);
      return;
    }
    if (msg.type === "fatal") this.fatalError = msg.error;
  }

  private settle(requestId: number | undefined, value: unknown): void {
    if (requestId === undefined) return;
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    if (value instanceof Error) p.reject(value);
    else p.resolve(value);
  }

  /** Submit a search. Cached submissions return the stored DTO immediately. */
  async submit<T>(kind: WorkerJobKind, body: Record<string, unknown>): Promise<SubmitResponse<T>> {
    await this.init();
    if (this.fatalError) throw new Error(this.fatalError);
    const key = cacheKey(kind, body);
    const cached = this.results.get(key);
    if (cached !== undefined) return { cached: true, result: cached as T };

    // One heavy search per tab: mark any previous running job cancelled.
    for (const job of this.jobs.values()) {
      if (job.status === "running") {
        job.status = "cancelled";
        job.settledAt = Date.now();
        job.progress = null;
      }
    }

    const id = this.nextId++;
    const job: LocalJob = {
      id,
      __key: key,
      kind,
      status: "running",
      progress: null,
      result: null,
      error: null,
      startedAt: Date.now(),
      elapsedMs: 0,
      settledAt: null,
    };
    this.jobs.set(id, job);
    // Fire-and-forget: status is observed through fetchJob/pollJob.
    this.worker?.postMessage({ type: "job", id, kind, payload: body } satisfies WorkerRequest);
    return { cached: false, jobId: id };
  }

  fetchJob(id: number): Promise<JobSnapshot<never>> {
    const job = this.jobs.get(id);
    if (!job) return Promise.reject(new Error(`unknown job ${id}`));
    return Promise.resolve({
      id: job.id,
      kind: job.kind,
      status: job.status,
      progress: job.progress,
      result: job.result as never,
      error: job.error,
      elapsedMs: job.settledAt ? job.elapsedMs : Date.now() - job.startedAt,
    });
  }

  async cancelJob(id: number): Promise<void> {
    const job = this.jobs.get(id);
    if (job && job.status === "running") {
      job.status = "cancelled";
      job.settledAt = Date.now();
      job.progress = null;
      this.worker?.postMessage({ type: "cancel", id } satisfies WorkerRequest);
    }
  }

  async deleteJob(id: number): Promise<void> {
    const job = this.jobs.get(id);
    if (job?.status === "done" && job.__key) this.results.delete(job.__key);
    this.jobs.delete(id);
  }

  /** Static data endpoints — also routed through the worker. */
  async fetchWindowDigits(start: number, end: number): Promise<string> {
    await this.init();
    const res = (await this.call({
      type: "job",
      id: -(this.nextRequestId++),
      kind: "window",
      payload: { start, end },
    })) as { digits: string };
    return res.digits;
  }

  async fetchSamples(count: number): Promise<{ total_digits: number; samples: Array<{ position: number; digit: number }> }> {
    await this.init();
    return this.call({
      type: "job",
      id: -(this.nextRequestId++),
      kind: "samples",
      payload: { count },
    }) as Promise<{ total_digits: number; samples: Array<{ position: number; digit: number }> }>;
  }

  /** Returns the camelCase DigitStats shape already produced by `statsDto`. */
  async fetchStats(): Promise<{ counts: number[]; totalDigits: number; chiSquare: number }> {
    await this.init();
    return this.call({ type: "job", id: -(this.nextRequestId++), kind: "stats", payload: {} }) as Promise<{
      counts: number[];
      totalDigits: number;
      chiSquare: number;
    }>;
  }

  getManifestInfo() {
    const m = this.manifest;
    if (!m) throw new Error("dataset manifest not loaded");
    return {
      format: m.format,
      totalDigits: m.totalDigits,
      chunkDigits: m.chunkDigits,
      chunkCount: m.chunkCount,
      firstDigits: m.firstDigits,
      checkpoints: m.checkpoints.map((c) => ({ query: c.query, firstPosition: c.firstPosition })),
      sha256Packed: m.sha256Packed,
    };
  }

  async storageStatus(): Promise<ChunkCacheStatus> {
    await this.init();
    const res = (await this.call({ type: "storageStatus", requestId: 0 })) as {
      status: ChunkCacheStatus;
    };
    return res.status;
  }

  async clearCache(): Promise<void> {
    await this.init();
    await this.call({ type: "clearCache" });
    this.results.clear();
  }
}

export const localBackend = new LocalBackend();
