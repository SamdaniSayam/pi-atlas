/**
 * Stage 6: best-effort persistent cache for verified dataset chunks.
 *
 * Design constraints from the GitHub-Pages-only audit:
 *  - IndexedDB is an OPTIMISATION, never a correctness dependency. Safari/iOS,
 *    private browsing and storage eviction may refuse or discard writes; every
 *    method swallows storage errors and the in-memory LRU in ChunkLoader stays
 *    authoritative for the session.
 *  - Only SHA-256-VERIFIED bytes are written. ChunkLoader verifies length and
 *    digest first, then calls the `onVerified` hook exposed by `cachedFetcher`;
 *    a corrupt/partial download can never poison the cache. A cached entry that
 *    fails verification is deleted before the error is propagated.
 *  - Cache entries are keyed by datasetId + chunk index, so a dataset upgrade
 *    cannot serve stale chunks. The HTTP `fetch(..., {cache:"force-cache"})`
 *    layer in chunkLoader.ts is the second (Cache API) tier.
 */

import type { ChunkFetcher, ChunkIntegrityError, ChunkSource } from "./chunkLoader";

const DB_NAME = "pi-atlas-chunks";
const DB_VERSION = 1;
const STORE = "verified";
const META_STORE = "meta";

export interface ChunkCacheStatus {
  /** Whether IndexedDB is available in this browser context. */
  available: boolean;
  /** Number of cached chunk entries (or null if unavailable). */
  entries: number | null;
  /** Bytes used / quota from navigator.storage.estimate() (best effort). */
  usage: number | null;
  quota: number | null;
  /** Total bytes of cached chunks tracked in our own meta store. */
  cachedBytes: number;
}

function keyOf(datasetId: string, index: number): string {
  return `${datasetId}:${index}`;
}

function openDb(): Promise<IDBDatabase | null> {
  try {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function txDone(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

/** Read a verified chunk from IndexedDB. Returns null on ANY failure. */
export async function readCachedChunk(
  datasetId: string,
  index: number,
): Promise<Uint8Array | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const value = await new Promise<ArrayBuffer | undefined>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(keyOf(datasetId, index));
      req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
      req.onerror = () => resolve(undefined);
    });
    return value ? new Uint8Array(value) : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Persist a verified chunk. Fire-and-forget safe; failures are swallowed. */
export async function writeCachedChunk(
  datasetId: string,
  index: number,
  bytes: Uint8Array,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    // Copy into a standalone ArrayBuffer: the source may be a WASM/fetch view.
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    // Read the byte counter in its OWN transaction. Awaiting inside a readwrite
    // transaction lets IDB auto-close it before the put — a classic IDB bug.
    const current = await new Promise<number>((resolve) => {
      const r = db.transaction(META_STORE, "readonly").objectStore(META_STORE).get("cachedBytes");
      r.onsuccess = () => resolve(typeof r.result === "number" ? r.result : 0);
      r.onerror = () => resolve(0);
    });
    const tx = db.transaction([STORE, META_STORE], "readwrite");
    tx.objectStore(STORE).put(copy.buffer, keyOf(datasetId, index));
    tx.objectStore(META_STORE).put(current + copy.length, "cachedBytes");
    await txDone(tx);
  } catch {
    // Storage is optional — ignore.
  } finally {
    db.close();
  }
}

/** Remove one cached chunk entry and adjust the byte counter (best effort). */
export async function deleteCachedChunk(datasetId: string, index: number): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const key = keyOf(datasetId, index);
    // Read size/counter in their own transactions: awaiting inside a readwrite
    // transaction lets IndexedDB auto-close it before the delete.
    const removed = await new Promise<number>((resolve) => {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result instanceof ArrayBuffer ? r.result.byteLength : 0);
      r.onerror = () => resolve(0);
    });
    const current = await new Promise<number>((resolve) => {
      const r = db.transaction(META_STORE, "readonly").objectStore(META_STORE).get("cachedBytes");
      r.onsuccess = () => resolve(typeof r.result === "number" ? r.result : 0);
      r.onerror = () => resolve(0);
    });
    const tx = db.transaction([STORE, META_STORE], "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.objectStore(META_STORE).put(Math.max(0, current - removed), "cachedBytes");
    await txDone(tx);
  } catch {
    // ignore
  } finally {
    db.close();
  }
}

/** Clear all cached chunks for a dataset (or all datasets when id omitted). */
export async function clearChunkCache(datasetId?: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const stores = [STORE, ...(datasetId ? [] : [META_STORE])];
    const tx = db.transaction(stores, "readwrite");
    if (datasetId) {
      const store = tx.objectStore(STORE);
      const range = IDBKeyRange.bound(`${datasetId}:`, `${datasetId}:\uffff`);
      store.delete(range);
    } else {
      tx.objectStore(STORE).clear();
      tx.objectStore(META_STORE).clear();
    }
    await txDone(tx);
  } catch {
    // ignore
  } finally {
    db.close();
  }
}

/** Best-effort storage report for the Settings screen. Never throws. */
export async function chunkCacheStatus(): Promise<ChunkCacheStatus> {
  const fallback: ChunkCacheStatus = {
    available: false,
    entries: null,
    usage: null,
    quota: null,
    cachedBytes: 0,
  };
  const db = await openDb();
  if (!db) return fallback;
  try {
    const entries = await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).count();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(0);
    });
    const cachedBytes = await new Promise<number>((resolve) => {
      const tx = db.transaction(META_STORE, "readonly");
      const r = tx.objectStore(META_STORE).get("cachedBytes");
      r.onsuccess = () => resolve(typeof r.result === "number" ? r.result : 0);
      r.onerror = () => resolve(0);
    });
    let usage: number | null = null;
    let quota: number | null = null;
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        usage = est.usage ?? null;
        quota = est.quota ?? null;
      }
    } catch {
      // estimate() unsupported — leave null.
    }
    return { available: true, entries, usage, quota, cachedBytes };
  } catch {
    return fallback;
  } finally {
    db.close();
  }
}

/** Swappable persistence layer; the default is the IndexedDB store above. */
export interface ChunkCacheStorage {
  read(datasetId: string, index: number): Promise<Uint8Array | null>;
  write(datasetId: string, index: number, bytes: Uint8Array): Promise<void>;
  delete(datasetId: string, index: number): Promise<void>;
}

const indexedDbStorage: ChunkCacheStorage = {
  read: (datasetId, index) => readCachedChunk(datasetId, index),
  write: async (datasetId, index, bytes) => {
    await writeCachedChunk(datasetId, index, bytes);
  },
  delete: async (datasetId, index) => {
    await deleteCachedChunk(datasetId, index);
  },
};

export interface CachedFetcherHandle {
  /** Reads cache→network and tags the result so ChunkLoader knows its origin. */
  fetcher: ChunkFetcher;
  /** Called by ChunkLoader only after length + SHA-256 verification succeeds. */
  onVerified: (index: number, bytes: Uint8Array, source: ChunkSource) => Promise<void>;
  /** Called by ChunkLoader when cached bytes fail verification. */
  onCorruptCached: (index: number, error: ChunkIntegrityError) => Promise<void>;
}

function standaloneBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Cache-first fetcher plus the verification hooks ChunkLoader calls. Bytes are
 * written only after ChunkLoader verifies them, and a corrupt cached entry is
 * deleted before the integrity error is propagated.
 */
export function cachedFetcher(
  networkFetch: (chunk: { file: string; index: number }, signal: AbortSignal) => Promise<ArrayBuffer>,
  datasetId: string,
  storage: ChunkCacheStorage = indexedDbStorage,
): CachedFetcherHandle {
  const fetcher: ChunkFetcher = async (chunk, _manifest, signal) => {
    const cached = await storage.read(datasetId, chunk.index);
    if (cached) return { buffer: standaloneBuffer(cached), source: "cache" };
    const buffer = await networkFetch(chunk, signal);
    return { buffer, source: "network" };
  };

  const onVerified = async (index: number, bytes: Uint8Array, source: ChunkSource): Promise<void> => {
    // A cache hit was already verified when it was written; only persist fresh
    // network bytes, and only after ChunkLoader's length + SHA-256 checks pass.
    if (source === "network") await storage.write(datasetId, index, bytes);
  };

  const onCorruptCached = async (index: number, _error: ChunkIntegrityError): Promise<void> => {
    await storage.delete(datasetId, index);
  };

  return { fetcher, onVerified, onCorruptCached };
}
