/**
 * On-demand dataset chunk loader (Stage 2 prototype).
 *
 * Responsibilities (Stage 4 deliverables in miniature): download only the
 * chunks a caller asks for, verify each chunk's SHA-256 before it is trusted,
 * deduplicate concurrent requests, cache verified chunks in memory with an
 * LRU bound, report progress, and support cancellation. Persistent caching
 * (IndexedDB) and Worker integration are layered on in Stage 6 — this module
 * deliberately has no DOM-storage or Worker dependency so it is easy to test.
 */
import type { WebChunkMeta, WebDatasetManifest } from "./manifest";
import { hexEqual, webCryptoSha256, type Sha256 } from "./sha256";

export class ChunkIntegrityError extends Error {
  readonly index: number;
  readonly expected: string;
  readonly actual: string;
  constructor(index: number, expected: string, actual: string) {
    super(`chunk ${index} integrity failure: expected ${expected}, got ${actual}`);
    this.name = "ChunkIntegrityError";
    this.index = index;
    this.expected = expected;
    this.actual = actual;
  }
}

/** Downloads raw packed bytes for one chunk. `signal` cancels the request. */
export interface ChunkFetcher {
  (chunk: WebChunkMeta, manifest: WebDatasetManifest, signal: AbortSignal): Promise<ArrayBuffer>;
}

/** Default fetcher: static same-origin file under `manifest.baseUrl`. */
export const httpChunkFetcher: ChunkFetcher = async (chunk, manifest, signal) => {
  const url = `${manifest.baseUrl}${chunk.file}`;
  const res = await fetch(url, { signal, cache: "force-cache" });
  if (!res.ok) throw new Error(`chunk ${chunk.index} fetch failed: HTTP ${res.status}`);
  return res.arrayBuffer();
};

export type LoadPhase = "downloading" | "verifying" | "cached" | "failed";

export interface ChunkLoadProgress {
  index: number;
  phase: LoadPhase;
  loaded: number;
  total: number;
}

export interface ChunkLoaderOptions {
  manifest: WebDatasetManifest;
  fetcher?: ChunkFetcher;
  sha256?: Sha256;
  /** Max verified chunks retained in memory (LRU). Default 32 (≈160 MB at 5 MB/chunk). */
  maxCachedChunks?: number;
  onProgress?: (progress: ChunkLoadProgress) => void;
}

export class ChunkLoader {
  private readonly manifest: WebDatasetManifest;
  private readonly fetcher: ChunkFetcher;
  private readonly sha256: Sha256;
  private readonly maxCached: number;
  private readonly onProgress?: (progress: ChunkLoadProgress) => void;

  /** Verified chunk bytes, Map insertion order = LRU order (oldest first). */
  private readonly cache = new Map<number, Uint8Array>();
  /** One in-flight download per chunk index — deduplicates concurrent callers. */
  private readonly inflight = new Map<number, Promise<Uint8Array>>();
  /** Per-chunk controllers so cancel(index) / cancelAll() can abort downloads. */
  private readonly controllers = new Map<number, AbortController>();

  constructor(opts: ChunkLoaderOptions) {
    this.manifest = opts.manifest;
    this.fetcher = opts.fetcher ?? httpChunkFetcher;
    this.sha256 = opts.sha256 ?? webCryptoSha256;
    this.maxCached = opts.maxCachedChunks ?? 32;
    this.onProgress = opts.onProgress;
  }

  get cachedCount(): number {
    return this.cache.size;
  }

  get inFlightCount(): number {
    return this.inflight.size;
  }

  isAvailable(index: number): boolean {
    return this.cache.has(index) || this.inflight.has(index);
  }

  /** Verified chunk bytes if resident; refreshes its LRU position. */
  getCached(index: number): Uint8Array | undefined {
    const bytes = this.cache.get(index);
    if (bytes) this.touch(index);
    return bytes;
  }

  /**
   * Ensure chunk `index` is loaded and verified, then return its packed bytes.
   * Concurrent calls for the same chunk share one download.
   */
  async loadChunk(index: number, signal?: AbortSignal): Promise<Uint8Array> {
    const meta = this.manifest.chunks[index];
    if (!meta) throw new Error(`chunk ${index} out of range (0..${this.manifest.chunkCount - 1})`);

    const cached = this.cache.get(index);
    if (cached) {
      this.touch(index);
      this.report(index, "cached", cached.length, meta.bytes);
      return cached;
    }

    const existing = this.inflight.get(index);
    if (existing) return existing;

    const controller = new AbortController();
    this.controllers.set(index, controller);
    const abortFromCaller = (): void => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abortFromCaller, { once: true });
    }

    const task = (async (): Promise<Uint8Array> => {
      try {
        this.report(index, "downloading", 0, meta.bytes);
        const buffer = await this.fetcher(meta, this.manifest, controller.signal);
        this.report(index, "verifying", buffer.byteLength, meta.bytes);
        if (buffer.byteLength !== meta.bytes) {
          throw new ChunkIntegrityError(index, meta.sha256, `length ${buffer.byteLength} != ${meta.bytes}`);
        }
        const bytes = new Uint8Array(buffer);
        const digest = await this.sha256(bytes);
        if (!hexEqual(digest, meta.sha256)) {
          throw new ChunkIntegrityError(index, meta.sha256, digest);
        }
        this.put(index, bytes);
        this.report(index, "cached", bytes.length, meta.bytes);
        return bytes;
      } catch (err) {
        this.report(index, "failed", 0, meta.bytes);
        throw err;
      } finally {
        this.controllers.delete(index);
        this.inflight.delete(index);
        if (signal) signal.removeEventListener("abort", abortFromCaller);
      }
    })();

    this.inflight.set(index, task);
    return task;
  }

  /** Abort a specific in-flight download (a later loadChunk call can retry). */
  cancel(index: number): void {
    this.controllers.get(index)?.abort();
  }

  /** Abort every in-flight download. */
  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  /** Abort downloads and drop all cached chunks (dataset change / clear action). */
  clear(): void {
    this.cancelAll();
    this.cache.clear();
  }

  private report(index: number, phase: LoadPhase, loaded: number, total: number): void {
    this.onProgress?.({ index, phase, loaded, total });
  }

  private touch(index: number): void {
    const bytes = this.cache.get(index);
    if (!bytes) return;
    this.cache.delete(index);
    this.cache.set(index, bytes);
  }

  private put(index: number, bytes: Uint8Array): void {
    if (this.cache.has(index)) this.cache.delete(index);
    this.cache.set(index, bytes);
    while (this.cache.size > this.maxCached) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
