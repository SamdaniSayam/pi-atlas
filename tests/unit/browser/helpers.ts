import { webcrypto } from "node:crypto";
import type { WebDatasetManifest, WebChunkMeta } from "../../../src/data/browser/manifest";
import { packDigits } from "../../../src/data/browser/packedDigits";
import { toHex, type Sha256 } from "../../../src/data/browser/sha256";

/** WebCrypto-backed SHA-256 for tests (jsdom lacks crypto.subtle). */
export const nodeSha256: Sha256 = async (bytes) => {
  const buffer: ArrayBuffer =
    bytes instanceof Uint8Array
      ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      : bytes;
  const digest = await webcrypto.subtle.digest("SHA-256", buffer);
  return toHex(new Uint8Array(digest));
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
