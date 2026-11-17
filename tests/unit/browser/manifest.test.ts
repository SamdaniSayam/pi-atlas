import { describe, it, expect } from "vitest";
import {
  validateManifest,
  chunkForPosition,
  chunksForRange,
  ManifestError,
} from "../../../src/data/browser/manifest";
import { makeDataset } from "./helpers";

describe("web manifest validation", () => {
  it("accepts a consistent generated manifest", async () => {
    const { manifest } = await makeDataset(100, 4);
    expect(() => validateManifest(manifest)).not.toThrow();
    const v = validateManifest(manifest);
    expect(v.chunkCount).toBe(4);
    expect(v.packedBytes).toBe(200);
  });

  it("rejects wrong version / format", async () => {
    const { manifest } = await makeDataset(100, 2);
    expect(() => validateManifest({ ...manifest, version: 99 })).toThrow(ManifestError);
    expect(() => validateManifest({ ...manifest, format: "unknown-v2" })).toThrow(ManifestError);
  });

  it("rejects inconsistent geometry", async () => {
    const { manifest } = await makeDataset(100, 2);
    expect(() => validateManifest({ ...manifest, chunkCount: 3 })).toThrow(/chunkCount/);
    expect(() => validateManifest({ ...manifest, packedBytes: 999 })).toThrow(/packedBytes/);
    const badOffset = { ...manifest, chunks: manifest.chunks.map((c, i) =>
      i === 1 ? { ...c, digitOffset: c.digitOffset + 2 } : c) };
    expect(() => validateManifest(badOffset)).toThrow(/digitOffset/);
    const badBytes = { ...manifest, chunks: manifest.chunks.map((c, i) =>
      i === 0 ? { ...c, bytes: c.bytes + 1 } : c) };
    expect(() => validateManifest(badBytes)).toThrow(/bytes/);
  });

  it("rejects malformed checksums", async () => {
    const { manifest } = await makeDataset(100, 2);
    expect(() => validateManifest({ ...manifest, sha256Packed: "xyz" })).toThrow(/sha256Packed/);
  });
});

describe("chunk index mapping", () => {
  it("maps 1-based positions to the right chunk at boundaries", async () => {
    const { manifest } = await makeDataset(100, 3);
    expect(chunkForPosition(manifest, 1)).toBe(0);
    expect(chunkForPosition(manifest, 100)).toBe(0);
    expect(chunkForPosition(manifest, 101)).toBe(1);
    expect(chunkForPosition(manifest, 300)).toBe(2);
    expect(() => chunkForPosition(manifest, 0)).toThrow(ManifestError);
    expect(() => chunkForPosition(manifest, 301)).toThrow(ManifestError);
  });

  it("returns the inclusive chunk span for a range crossing a boundary", async () => {
    const { manifest } = await makeDataset(100, 3);
    expect(chunksForRange(manifest, 90, 110)).toEqual([0, 1]);
    expect(chunksForRange(manifest, 5, 7)).toEqual([0]);
    expect(() => chunksForRange(manifest, 50, 40)).toThrow(ManifestError);
  });
});
