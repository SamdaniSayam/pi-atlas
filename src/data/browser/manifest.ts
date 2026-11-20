/**
 * Browser dataset manifest — `pi-atlas-web-manifest-v1` (Stage 2 prototype).
 *
 * A thin, browser-facing descriptor over the existing `pi-atlas-packed-v1`
 * dataset. It adds the fields a network client needs (chunk filenames, byte
 * offsets/lengths, dataset version, format compatibility) without changing a
 * single packed chunk: the SHA-256 values are the same ones the Rust service
 * and `scripts/pack_dataset.py` already verify.
 *
 * Positions are 1-based decimal positions after the point; `digitOffset` is a
 * 0-based digit offset (so a digit at 0-based offset d is at position d+1).
 * The leading integer digit "3" is never part of the dataset.
 */

export const WEB_MANIFEST_VERSION = 1 as const;
export const SUPPORTED_PACK_FORMATS = ["pi-atlas-packed-v1"] as const;

export interface WebChunkMeta {
  /** 0-based chunk index; also the array position. */
  index: number;
  /** Filename relative to `baseUrl` (e.g. `chunk_00000.bin`). */
  file: string;
  /** Number of decimal digits in this chunk (even). */
  digits: number;
  /** Packed byte length (= digits / 2). */
  bytes: number;
  /** Byte offset of this chunk in the concatenated packed stream. */
  packedOffset: number;
  /** 0-based digit offset of this chunk's first digit. */
  digitOffset: number;
  /** SHA-256 (lowercase hex) of this chunk's packed bytes. */
  sha256: string;
}

export interface WebDatasetManifest {
  /** Schema version of this browser manifest. */
  version: number;
  /** Packed-format id this manifest describes (format compatibility). */
  format: string;
  /** Stable dataset identity; change to invalidate all cached chunks. */
  datasetId: string;
  totalDigits: number;
  chunkDigits: number;
  chunkCount: number;
  packedBytes: number;
  /** First 64 digits after the point (integrity sanity check). */
  firstDigits: string;
  /** SHA-256 over all packed chunks concatenated. */
  sha256Packed: string;
  /** URL prefix for chunk files. Relative to the document (e.g. `chunks/`). */
  baseUrl: string;
  /** Optional filename template, informational (`chunk_{index:05d}.bin`). */
  filenameTemplate: string;
  chunks: WebChunkMeta[];
  checkpoints: Array<{ query: string; firstPosition: number }>;
  /** Search-index metadata. `none` = full sequential scan is required. */
  searchIndex: { kind: string; note?: string };
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Validate a parsed manifest object; throws ManifestError on any inconsistency. */
export function validateManifest(value: unknown): WebDatasetManifest {
  if (typeof value !== "object" || value === null) {
    throw new ManifestError("manifest is not an object");
  }
  const m = value as Record<string, unknown>;
  if (m.version !== WEB_MANIFEST_VERSION) {
    throw new ManifestError(`unsupported manifest version: ${String(m.version)}`);
  }
  if (typeof m.format !== "string" || !SUPPORTED_PACK_FORMATS.includes(m.format as never)) {
    throw new ManifestError(`unsupported pack format: ${String(m.format)}`);
  }
  if (typeof m.datasetId !== "string" || m.datasetId.length === 0) {
    throw new ManifestError("datasetId must be a non-empty string");
  }
  const totalDigits = m.totalDigits;
  const chunkDigits = m.chunkDigits;
  if (!Number.isSafeInteger(totalDigits) || (totalDigits as number) <= 0 || (totalDigits as number) % 2 !== 0) {
    throw new ManifestError("totalDigits must be a positive even safe integer");
  }
  if (!Number.isSafeInteger(chunkDigits) || (chunkDigits as number) <= 0 || (chunkDigits as number) % 2 !== 0) {
    throw new ManifestError("chunkDigits must be a positive even safe integer");
  }
  const expectedChunks = Math.ceil((totalDigits as number) / (chunkDigits as number));
  if (m.chunkCount !== expectedChunks) {
    throw new ManifestError(`chunkCount ${String(m.chunkCount)} != expected ${expectedChunks}`);
  }
  if (typeof m.firstDigits !== "string" || !/^[0-9]+$/.test(m.firstDigits)) {
    throw new ManifestError("firstDigits must be a digit string");
  }
  if (m.firstDigits.length > (totalDigits as number)) {
    throw new ManifestError("firstDigits longer than dataset");
  }
  if (typeof m.sha256Packed !== "string" || !HEX64.test(m.sha256Packed)) {
    throw new ManifestError("sha256Packed must be 64 lowercase hex chars");
  }
  if (typeof m.baseUrl !== "string" || typeof m.filenameTemplate !== "string") {
    throw new ManifestError("baseUrl and filenameTemplate must be strings");
  }
  if (!Array.isArray(m.chunks) || m.chunks.length !== expectedChunks) {
    throw new ManifestError("chunks length != chunkCount");
  }

  let digitAcc = 0;
  let byteAcc = 0;
  const chunks = m.chunks.map((raw, i): WebChunkMeta => {
    if (typeof raw !== "object" || raw === null) throw new ManifestError(`chunk ${i} is not an object`);
    const c = raw as Record<string, unknown>;
    if (c.index !== i) throw new ManifestError(`chunk ${i} has wrong index ${String(c.index)}`);
    if (typeof c.file !== "string" || c.file.length === 0) throw new ManifestError(`chunk ${i} has no file`);
    if (!Number.isSafeInteger(c.digits) || (c.digits as number) <= 0 || (c.digits as number) % 2 !== 0) {
      throw new ManifestError(`chunk ${i} digits invalid`);
    }
    // chunkForPosition()/chunksForRange() assume every chunk except the last
    // holds exactly `chunkDigits`; a manifest that violates that invariant
    // would silently map positions into the wrong (SHA-verified) chunk.
    const expectedDigits =
      i === expectedChunks - 1
        ? (totalDigits as number) - i * (chunkDigits as number)
        : (chunkDigits as number);
    if ((c.digits as number) !== expectedDigits) {
      throw new ManifestError(`chunk ${i} digits ${String(c.digits)} != expected ${expectedDigits}`);
    }
    if (c.bytes !== (c.digits as number) / 2) throw new ManifestError(`chunk ${i} bytes != digits/2`);
    if (c.packedOffset !== byteAcc) throw new ManifestError(`chunk ${i} packedOffset mismatch`);
    if (c.digitOffset !== digitAcc) throw new ManifestError(`chunk ${i} digitOffset mismatch`);
    if (typeof c.sha256 !== "string" || !HEX64.test(c.sha256)) {
      throw new ManifestError(`chunk ${i} sha256 must be 64 lowercase hex chars`);
    }
    digitAcc += c.digits as number;
    byteAcc += c.bytes as number;
    return {
      index: i,
      file: c.file as string,
      digits: c.digits as number,
      bytes: c.bytes as number,
      packedOffset: c.packedOffset as number,
      digitOffset: c.digitOffset as number,
      sha256: c.sha256 as string,
    };
  });

  if (digitAcc !== totalDigits) throw new ManifestError(`chunk digit sum ${digitAcc} != total ${String(totalDigits)}`);
  if (m.packedBytes !== byteAcc) throw new ManifestError(`packedBytes ${String(m.packedBytes)} != ${byteAcc}`);
  if (!Array.isArray(m.checkpoints)) throw new ManifestError("checkpoints must be an array");
  const checkpoints = m.checkpoints.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) throw new ManifestError(`checkpoint ${i} is not an object`);
    const c = raw as Record<string, unknown>;
    if (typeof c.query !== "string") throw new ManifestError(`checkpoint ${i} query must be a string`);
    if (!Number.isSafeInteger(c.firstPosition) || (c.firstPosition as number) < 1) {
      // A common producer bug is copying the core manifest's `first_position`
      // (snake_case) into this camelCase manifest; fail loudly instead of
      // silently yielding `firstPosition: undefined` in ManifestInfo.
      throw new ManifestError(
        `checkpoint ${i} firstPosition must be a positive safe integer (got ${String(c.firstPosition)}; ` +
          "did the producer copy snake_case 'first_position'?)",
      );
    }
    return { query: c.query as string, firstPosition: c.firstPosition as number };
  });
  if (typeof m.searchIndex !== "object" || m.searchIndex === null || typeof (m.searchIndex as Record<string, unknown>).kind !== "string") {
    throw new ManifestError("searchIndex.kind must be a string");
  }

  return {
    version: WEB_MANIFEST_VERSION,
    format: m.format as string,
    datasetId: m.datasetId as string,
    totalDigits: totalDigits as number,
    chunkDigits: chunkDigits as number,
    chunkCount: expectedChunks,
    packedBytes: byteAcc,
    firstDigits: m.firstDigits as string,
    sha256Packed: m.sha256Packed as string,
    baseUrl: m.baseUrl as string,
    filenameTemplate: m.filenameTemplate as string,
    chunks,
    checkpoints,
    searchIndex: m.searchIndex as WebDatasetManifest["searchIndex"],
  };
}

/** 0-based chunk index containing a 1-based decimal position. */
export function chunkForPosition(manifest: WebDatasetManifest, position: number): number {
  if (position < 1 || position > manifest.totalDigits) {
    throw new ManifestError(`position ${position} out of range [1, ${manifest.totalDigits}]`);
  }
  return Math.floor((position - 1) / manifest.chunkDigits);
}

/** Inclusive 0-based chunk indices covering 1-based positions [start, end]. */
export function chunksForRange(manifest: WebDatasetManifest, start: number, end: number): number[] {
  if (start < 1 || end < start || end > manifest.totalDigits) {
    throw new ManifestError(`range [${start}, ${end}] out of bounds`);
  }
  const first = chunkForPosition(manifest, start);
  const last = chunkForPosition(manifest, end);
  const out: number[] = [];
  for (let i = first; i <= last; i += 1) out.push(i);
  return out;
}
