import { describe, it, expect, vi } from "vitest";
import { ChunkLoader, ChunkIntegrityError, type ChunkFetcher, type ChunkLoadProgress } from "../../../src/data/browser/chunkLoader";
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
