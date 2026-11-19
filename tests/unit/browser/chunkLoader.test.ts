import { describe, it, expect, vi } from "vitest";
import { ChunkLoader, ChunkIntegrityError, type ChunkFetcher, type ChunkLoadProgress } from "../../../src/data/browser/chunkLoader";
import { cachedFetcher, type ChunkCacheStorage } from "../../../src/data/browser/chunkCache";
import { WasmChunkResidency, type WasmChunkEngine } from "../../../src/data/browser/wasmChunkResidency";
import { digitAt, unpackRange } from "../../../src/data/browser/packedDigits";
import { makeDataset, nodeSha256, type SyntheticDataset } from "./helpers";

function fetcherFor(ds: SyntheticDataset, corruptIndex = -1): ChunkFetcher {
  return async (chunk) => {
    const bytes = ds.chunks[chunk.index];
    const copy = new Uint8Array(bytes);
    if (chunk.index === corruptIndex) copy[0] ^= 0x01;
    return copy.buffer;
  };
}

interface MemoryCache {
  storage: ChunkCacheStorage;
  entries: Map<string, Uint8Array>;
  writes: number[];
  deletes: number[];
}

function memoryCache(initial: ArrayBuffer[] = []): MemoryCache {
  const entries = new Map<string, Uint8Array>(initial.map((buffer, index) => [`synthetic-test:${index}`, new Uint8Array(buffer)]));
  const writes: number[] = [];
  const deletes: number[] = [];
  return {
    entries,
    writes,
    deletes,
    storage: {
      read: async (_datasetId, index) => entries.get(`synthetic-test:${index}`) ?? null,
      write: async (_datasetId, index, bytes) => {
        writes.push(index);
        entries.set(`synthetic-test:${index}`, new Uint8Array(bytes));
      },
      delete: async (_datasetId, index) => {
        deletes.push(index);
        entries.delete(`synthetic-test:${index}`);
      },
    },
  };
}

describe("ChunkLoader", () => {
  it("downloads, verifies, and returns exact packed bytes", async () => {
    const ds = await makeDataset(100, 3);
    const loader = new ChunkLoader({ manifest: ds.manifest, fetcher: fetcherFor(ds), sha256: nodeSha256 });
    const bytes = await loader.loadChunk(0);
    expect(Array.from(bytes)).toEqual(Array.from(ds.chunks[0]));
    expect(loader.cachedCount).toBe(1);
  });

  it("serves a cache hit without re-fetching", async () => {
    const ds = await makeDataset(100, 2);
    const fetcher = vi.fn(fetcherFor(ds));
    const phases: ChunkLoadProgress["phase"][] = [];
    const loader = new ChunkLoader({
      manifest: ds.manifest, fetcher, sha256: nodeSha256,
      onProgress: (p) => phases.push(p.phase),
    });
    await loader.loadChunk(0);
    await loader.loadChunk(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(phases).toContain("downloading");
    expect(phases).toContain("verifying");
    expect(phases).toContain("cached");
  });

  it("deduplicates concurrent requests for the same chunk", async () => {
    const ds = await makeDataset(100, 2);
    const fetcher = vi.fn(async (chunk: { index: number }) => {
      await new Promise((r) => setTimeout(r, 10));
      return ds.chunks[chunk.index].buffer;
    }) as unknown as ChunkFetcher;
    const loader = new ChunkLoader({ manifest: ds.manifest, fetcher, sha256: nodeSha256 });
    const [a, b] = await Promise.all([loader.loadChunk(1), loader.loadChunk(1)]);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a corrupted chunk and does not cache it", async () => {
    const ds = await makeDataset(100, 2);
    const phases: ChunkLoadProgress["phase"][] = [];
    const loader = new ChunkLoader({
      manifest: ds.manifest, fetcher: fetcherFor(ds, 1), sha256: nodeSha256,
      onProgress: (p) => phases.push(p.phase),
    });
    await expect(loader.loadChunk(1)).rejects.toBeInstanceOf(ChunkIntegrityError);
    expect(loader.cachedCount).toBe(0);
    expect(phases).toContain("failed");
  });

  it("rejects wrong-length payloads", async () => {
    const ds = await makeDataset(100, 2);
    const short: ChunkFetcher = async () => new Uint8Array(1).buffer;
    const loader = new ChunkLoader({ manifest: ds.manifest, fetcher: short, sha256: nodeSha256 });
    await expect(loader.loadChunk(0)).rejects.toBeInstanceOf(ChunkIntegrityError);
  });

  it("aborts an in-flight download via the caller signal and via cancel()", async () => {
    const ds = await makeDataset(100, 2);
    const hanging: ChunkFetcher = (_c, _m, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    const loader = new ChunkLoader({ manifest: ds.manifest, fetcher: hanging, sha256: nodeSha256 });
    const controller = new AbortController();
    const p = loader.loadChunk(0, controller.signal).catch((e: Error) => e.message);
    controller.abort();
    expect(await p).toBe("aborted");

    const p2 = loader.loadChunk(1).catch((e: Error) => e.message);
    loader.cancel(1);
    expect(await p2).toBe("aborted");
  });

  it("evicts least-recently-used chunks beyond the memory cap", async () => {
    const ds = await makeDataset(100, 4);
    const loader = new ChunkLoader({
      manifest: ds.manifest, fetcher: fetcherFor(ds), sha256: nodeSha256, maxCachedChunks: 2,
    });
    await loader.loadChunk(0);
    await loader.loadChunk(1);
    await loader.getCached(0); // touch 0 so 1 becomes oldest
    await loader.loadChunk(2);
    expect(loader.cachedCount).toBe(2);
    expect(loader.isAvailable(0)).toBe(true);
    expect(loader.isAvailable(1)).toBe(false);
    expect(loader.isAvailable(2)).toBe(true);
  });

  it("clear() drops all cached chunks", async () => {
    const ds = await makeDataset(100, 2);
    const loader = new ChunkLoader({ manifest: ds.manifest, fetcher: fetcherFor(ds), sha256: nodeSha256 });
    await loader.loadChunk(0);
    loader.clear();
    expect(loader.cachedCount).toBe(0);
  });

  it("frees WASM chunks when they leave the bounded in-memory LRU", async () => {
    const ds = await makeDataset(100, 6);
    const resident = new Set<number>();
    const dropped: number[] = [];
    const engine: WasmChunkEngine = {
      has_chunk: (index) => resident.has(index),
      drop_chunk: (index) => {
        resident.delete(index);
        dropped.push(index);
      },
      loaded_chunks: () => resident.size,
    };
    let loader!: ChunkLoader;
    const residency = new WasmChunkResidency({
      engine,
      loader: { cachedIndices: () => loader.cachedIndices() },
      chunkCount: ds.manifest.chunkCount,
    });
    loader = new ChunkLoader({
      manifest: ds.manifest,
      fetcher: fetcherFor(ds),
      sha256: nodeSha256,
      maxCachedChunks: 2,
      onEvict: (index) => residency.noteEvicted(index),
    });
    const all = ds.manifest.chunks.map((c) => c.index);

    // A full scan pins every chunk until the job ends (require_all()).
    residency.beginJob(1, all);
    for (const index of all) {
      await loader.loadChunk(index);
      resident.add(index);
    }
    expect(residency.residentCount).toBe(all.length);
    expect(dropped).toEqual([]);

    residency.endJob(1);
    expect(loader.cachedIndices()).toEqual([4, 5]);
    expect(residency.residentCount).toBe(2);
    expect([...resident]).toEqual([4, 5]);
    expect(dropped).toEqual([0, 1, 2, 3]);

    // A second full scan reloads the dropped chunks but does not grow residency.
    residency.beginJob(2, all);
    for (const index of all) {
      await loader.loadChunk(index);
      resident.add(index);
    }
    residency.endJob(2);
    expect(residency.residentCount).toBe(2);
  });

  it("persists only verified bytes and evicts a corrupt cached entry", async () => {
    const ds = await makeDataset(100, 2);
    const corrupt = new Uint8Array(ds.chunks[0]);
    corrupt[0] ^= 0x01;
    const mem = memoryCache([corrupt.buffer]);
    const networkFetch = vi.fn(async (chunk: { file: string; index: number }): Promise<ArrayBuffer> => {
      const source = ds.chunks[chunk.index];
      return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
    });
    const cache = cachedFetcher(networkFetch, ds.manifest.datasetId, mem.storage);
    const loader = new ChunkLoader({
      manifest: ds.manifest,
      fetcher: cache.fetcher,
      onVerified: cache.onVerified,
      onCorruptCached: cache.onCorruptCached,
      sha256: nodeSha256,
    });

    await expect(loader.loadChunk(0)).rejects.toBeInstanceOf(ChunkIntegrityError);
    expect(mem.deletes).toEqual([0]);
    expect(mem.entries.has("synthetic-test:0")).toBe(false);
    expect(mem.writes).toEqual([]);

    // The retry now comes from the network and is written only after hashing.
    const bytes = await loader.loadChunk(0);
    expect(Array.from(bytes)).toEqual(Array.from(ds.chunks[0]));
    expect(networkFetch).toHaveBeenCalledTimes(1);
    expect(mem.writes).toEqual([0]);
  });

  it("never writes a corrupt network response to the cache", async () => {
    const ds = await makeDataset(100, 2);
    const mem = memoryCache();
    const corruptNetworkFetch = async (): Promise<ArrayBuffer> => {
      const copy = new Uint8Array(ds.chunks[0]);
      copy[0] ^= 0x01;
      return copy.buffer;
    };
    const cache = cachedFetcher(corruptNetworkFetch, ds.manifest.datasetId, mem.storage);
    const loader = new ChunkLoader({
      manifest: ds.manifest,
      fetcher: cache.fetcher,
      onVerified: cache.onVerified,
      onCorruptCached: cache.onCorruptCached,
      sha256: nodeSha256,
    });
    await expect(loader.loadChunk(0)).rejects.toBeInstanceOf(ChunkIntegrityError);
    expect(mem.writes).toEqual([]);
    expect(mem.deletes).toEqual([]);
    expect(mem.entries.size).toBe(0);
  });
});

describe("packed digit reads", () => {
  it("unpacks the same digits the packer wrote", async () => {
    const ds = await makeDataset(100, 1);
    expect(unpackRange(ds.chunks[0], 0, 20)).toBe(ds.ascii.slice(0, 20));
    expect(unpackRange(ds.chunks[0], 78, 22)).toBe(ds.ascii.slice(78, 100));
    expect(digitAt(ds.chunks[0], 0)).toBe(Number(ds.ascii[0]));
    expect(digitAt(ds.chunks[0], 99)).toBe(Number(ds.ascii[99]));
  });
});
