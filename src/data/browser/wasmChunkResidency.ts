/**
 * Keep WASM-owned chunk memory aligned with the bounded JS LRU.
 *
 * A full scan must briefly have every chunk resident (PiEngine::require_all),
 * so an eviction from ChunkLoader's 32-entry LRU cannot immediately call
 * drop_chunk() while the scan is running. Instead, each job declares the chunk
 * indices it may touch; when the last job needing an evicted index finishes,
 * sync() drops every WASM chunk that is neither in the LRU nor pinned by a
 * still-running job. Residency therefore peaks at dataset size during a scan
 * and settles back to the 32-chunk JS cache afterwards.
 */
import type { ChunkLoader } from "./chunkLoader";

export interface WasmChunkEngine {
  has_chunk(index: number): boolean;
  drop_chunk(index: number): void;
  loaded_chunks?(): number;
}

export interface WasmResidencyOptions {
  engine: WasmChunkEngine;
  loader: Pick<ChunkLoader, "cachedIndices">;
  chunkCount: number;
}

export class WasmChunkResidency {
  private readonly engine: WasmChunkEngine;
  private readonly loader: Pick<ChunkLoader, "cachedIndices">;
  private readonly chunkCount: number;
  private readonly jobChunks = new Map<number, Set<number>>();
  private readonly evicted = new Set<number>();

  constructor(opts: WasmResidencyOptions) {
    this.engine = opts.engine;
    this.loader = opts.loader;
    this.chunkCount = opts.chunkCount;
  }

  /** Declare every index a job may read, before any loads happen. */
  beginJob(id: number, indices: readonly number[]): void {
    this.jobChunks.set(id, new Set(indices));
  }

  /** Called by ChunkLoader.onEvict; deferred while any job is active. */
  noteEvicted(index: number): void {
    this.evicted.add(index);
    if (this.jobChunks.size === 0) this.sync();
  }

  /** Drop chunks no longer needed by the loader LRU or any active job. */
  endJob(id: number): void {
    this.jobChunks.delete(id);
    this.sync();
  }

  /** Discard bookkeeping for cancelled jobs and re-sync immediately. */
  cancelJob(id: number): void {
    this.jobChunks.delete(id);
    this.sync();
  }

  get pendingEvictions(): number[] {
    return [...this.evicted];
  }

  get residentCount(): number {
    return this.engine.loaded_chunks?.() ?? this.loadedIndices().length;
  }

  private loadedIndices(): number[] {
    const loaded: number[] = [];
    for (let i = 0; i < this.chunkCount; i += 1) {
      if (this.engine.has_chunk(i)) loaded.push(i);
    }
    return loaded;
  }

  private sync(): void {
    const keep = new Set<number>(this.loader.cachedIndices());
    for (const indices of this.jobChunks.values()) {
      for (const index of indices) keep.add(index);
    }
    for (let i = 0; i < this.chunkCount; i += 1) {
      if (!keep.has(i) && this.engine.has_chunk(i)) this.engine.drop_chunk(i);
    }
    this.evicted.clear();
  }
}
