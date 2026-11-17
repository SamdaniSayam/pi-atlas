import { createHash } from "node:crypto";
import type { WebDatasetManifest, WebChunkMeta } from "../../../src/data/browser/manifest";
import { packDigits } from "../../../src/data/browser/packedDigits";
import { toHex, type Sha256 } from "../../../src/data/browser/sha256";

/**
 * Node-backed SHA-256 for tests. Uses createHash rather than webcrypto.subtle:
 * it is realm-agnostic, so ArrayBuffers created by jsdom on Node 20 in CI are
 * accepted (cross-realm instances fail SubtleCrypto's strict instanceof check).
 */
export const nodeSha256: Sha256 = async (bytes) => {
  const view = bytes as Uint8Array;
  const data = typeof view.byteOffset === "number" && view.buffer
    ? Buffer.from(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength)
    : Buffer.from(bytes as ArrayBuffer);
  return createHash("sha256").update(data).digest("hex");
};

export interface SyntheticDataset {
  ascii: string;
  chunks: Uint8Array[];
  manifest: WebDatasetManifest;
}

/** Deterministic packed dataset used only by unit tests. */
export async function makeDataset(chunkDigits: number, chunkCount: number): Promise<SyntheticDataset> {
  const totalDigits = chunkDigits * chunkCount;
  let seed = 12345;
  let ascii = "";
  for (let i = 0; i < totalDigits; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    ascii += String(seed % 10);
  }

  const chunks: Uint8Array[] = [];
  const metas: WebChunkMeta[] = [];
  let digitOffset = 0;
  let packedOffset = 0;
  let whole = "";
  for (let i = 0; i < chunkCount; i += 1) {
    const block = ascii.slice(i * chunkDigits, (i + 1) * chunkDigits);
    const bytes = packDigits(block);
    chunks.push(bytes);
    whole += toHex(bytes);
    metas.push({
      index: i,
      file: `chunk_${String(i).padStart(5, "0")}.bin`,
      digits: chunkDigits,
      bytes: bytes.length,
      packedOffset,
      digitOffset,
      sha256: await nodeSha256(bytes),
    });
    digitOffset += chunkDigits;
    packedOffset += bytes.length;
  }

  const manifest: WebDatasetManifest = {
    version: 1,
    format: "pi-atlas-packed-v1",
    datasetId: "synthetic-test",
    totalDigits,
    chunkDigits,
    chunkCount,
    packedBytes: packedOffset,
    firstDigits: ascii.slice(0, 64),
    sha256Packed: await nodeSha256(Uint8Array.from(whole.match(/.{2}/g)!.map((h) => parseInt(h, 16)))),
    baseUrl: "chunks/",
    filenameTemplate: "chunk_{index:05d}.bin",
    chunks: metas,
    checkpoints: [{ query: "12", firstPosition: 148 }],
    searchIndex: { kind: "none" },
  };
  return { ascii, chunks, manifest };
}
