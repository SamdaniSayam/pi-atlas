import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { validateManifest, type WebChunkMeta, type WebDatasetManifest } from "../../../src/data/browser/manifest";
import { ChunkLoader, type ChunkFetcher } from "../../../src/data/browser/chunkLoader";
import { packDigits, unpackRange } from "../../../src/data/browser/packedDigits";
import { nodeSha256 } from "./helpers";

/** Build a real web manifest from the committed 2M ASCII fixture. */
async function buildFromFixture(): Promise<{ ascii: string; packed: Uint8Array[]; manifest: WebDatasetManifest }> {
  const digits = readFileSync(resolve(process.cwd(), "public/pi-2m.txt"), "ascii").replace(/\s+/g, "");
  const chunkDigits = 1_000_000;
  const ascii = digits.slice(0, chunkDigits * Math.floor(digits.length / chunkDigits));
  const packed: Uint8Array[] = [];
  const metas: WebChunkMeta[] = [];
  let digitOffset = 0;
  let packedOffset = 0;
  for (let i = 0; i * chunkDigits < ascii.length; i += 1) {
    const block = ascii.slice(i * chunkDigits, (i + 1) * chunkDigits);
    const bytes = packDigits(block);
    packed.push(bytes);
    metas.push({
      index: i,
      file: `chunk_${String(i).padStart(5, "0")}.bin`,
      digits: block.length,
      bytes: bytes.length,
      packedOffset,
      digitOffset,
      sha256: await nodeSha256(bytes),
    });
    digitOffset += block.length;
    packedOffset += bytes.length;
  }
  const manifest: WebDatasetManifest = {
    version: 1,
    format: "pi-atlas-packed-v1",
    datasetId: "pi-2m-fixture",
    totalDigits: digitOffset,
    chunkDigits,
    chunkCount: metas.length,
    packedBytes: packedOffset,
    firstDigits: ascii.slice(0, 64),
    sha256Packed: await nodeSha256(Buffer.concat(packed.map((p) => Buffer.from(p)))),
    baseUrl: "dataset/2m/chunks/",
    filenameTemplate: "chunk_{index:05d}.bin",
    chunks: metas,
    checkpoints: [{ query: "12", firstPosition: ascii.indexOf("12") + 1 }],
    searchIndex: { kind: "none" },
  };
  return { ascii, packed, manifest };
}

describe("real 2M fixture through the browser chunk path", () => {
  it("manifest validates and chunks reproduce the fixture with correct checkpoints", async () => {
    const { ascii, packed, manifest } = await buildFromFixture();
    expect(manifest.totalDigits).toBe(2_000_000);
    expect(manifest.chunkCount).toBe(2);
    expect(() => validateManifest(manifest)).not.toThrow();

    const fetcher: ChunkFetcher = async (chunk) => {
      const bytes = packed[chunk.index];
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    };
    const loader = new ChunkLoader({ manifest, fetcher, sha256: nodeSha256 });
    const c0 = await loader.loadChunk(0);
    const c1 = await loader.loadChunk(1);

    // First 64 digits and the final digits must round-trip byte-for-byte.
    expect(unpackRange(c0, 0, 64)).toBe(manifest.firstDigits);
    expect(unpackRange(c1, packed[1].length * 2 - 32, 32)).toBe(ascii.slice(-32));

    // Known checkpoint: "12" first occurs at position 148 in π (1-based, after point).
    expect(manifest.checkpoints[0].firstPosition).toBe(148);
    expect(ascii.indexOf("12")).toBe(147);
  });
});
