/**
 * Digit windows on demand (FR-01 data access, D17).
 *
 * The 1B-digit dataset never enters the browser whole: components request the
 * slices they need through the service's `/window` endpoint. Here we cache
 * fixed 2,048-digit buckets so scrolling/panning re-uses already-fetched
 * digits, and expose both a React hook (re-renders on arrival) and a plain
 * awaitable range getter (for one-shot uses like PNG export context).
 */
import { useEffect, useReducer } from "react";
import { fetchWindowDigits } from "./piApi";

/** Bucket size in digits. Small enough that a missed bucket costs ~4 KB. */
const BUCKET = 2048;
/** Hard cap on cached buckets (≈ 2 MB of digit text) — LRU by insertion. */
const MAX_BUCKETS = 24;

const cache = new Map<number, string>(); // bucket index -> 2048 digits
const inflight = new Map<number, Promise<string>>();
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifySoon(): void {
  if (notifyTimer !== null) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    listeners.forEach((l) => l());
  }, 30);
}

function bucketIndex(position: number): number {
  return Math.floor((Math.max(1, position) - 1) / BUCKET);
}

function bucketStart(b: number): number {
  return b * BUCKET + 1;
}

/** Mark a bucket as recently used without changing its value. */
function touchBucket(b: number): string | undefined {
  const digits = cache.get(b);
  if (digits === undefined) return undefined;
  cache.delete(b);
  cache.set(b, digits);
  return digits;
}

async function loadBucket(b: number): Promise<string> {
  const cached = cache.get(b);
  if (cached !== undefined) {
    touchBucket(b);
    return cached;
  }
  const existing = inflight.get(b);
  if (existing) return existing;
  const p = fetchWindowDigits(bucketStart(b), bucketStart(b) + BUCKET - 1).finally(() => {
    inflight.delete(b);
  });
  inflight.set(b, p);
  try {
    const digits = await p;
    cache.delete(b);
    cache.set(b, digits);
    while (cache.size > MAX_BUCKETS) {
      // Evict the least-recently-used bucket (Map insertion order).
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    notifySoon();
    return digits;
  } catch (err) {
    cache.delete(b);
    throw err;
  }
}

/** Subscribe to window arrivals; returns unsubscribe. */
export function subscribeDigitWindows(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Synchronous read of a contiguous range; returns null until all buckets arrive. */
export function getCachedRange(start: number, count: number): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(count)) return null;
  const n = Math.trunc(count);
  if (n <= 0) return "";
  const firstPos = Math.max(1, Math.trunc(start));
  const first = bucketIndex(firstPos);
  const last = bucketIndex(firstPos + n - 1);
  let out = "";
  for (let b = first; b <= last; b += 1) {
    const digits = touchBucket(b);
    if (digits === undefined) return null;
    out += digits;
  }
  const offset = firstPos - bucketStart(first);
  return out.slice(offset, offset + n);
}

/** Kick off background loads for every bucket covering [start, start+count). */
export function prefetchRange(start: number, count: number): void {
  if (!Number.isFinite(start) || !Number.isFinite(count)) return;
  const n = Math.trunc(count);
  if (n <= 0) return;
  const firstPos = Math.max(1, Math.trunc(start));
  const first = bucketIndex(firstPos);
  const last = bucketIndex(firstPos + n - 1);
  for (let b = first; b <= last; b += 1) {
    if (!cache.has(b) && !inflight.has(b)) void loadBucket(b).catch(() => undefined);
  }
}

/** Await the digits for 1-based inclusive [start, start+count) (cache-aware). */
export async function fetchDigitRange(start: number, count: number): Promise<string> {
  const safeStart = Number.isFinite(start) ? Math.max(1, Math.trunc(start)) : 1;
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const cached = getCachedRange(safeStart, safeCount);
  if (cached !== null) return cached;
  await Promise.all(
    rangeBuckets(safeStart, safeCount).map((b) =>
      loadBucket(b).catch(() => {
        throw new Error(`Could not load digits near position ${safeStart}.`);
      }),
    ),
  );
  const digits = getCachedRange(safeStart, safeCount);
  if (digits === null) throw new Error(`Could not load digits near position ${safeStart}.`);
  return digits;
}

function rangeBuckets(start: number, count: number): number[] {
  const first = bucketIndex(start);
  const last = bucketIndex(start + count - 1);
  const out: number[] = [];
  for (let b = first; b <= last; b += 1) out.push(b);
  return out;
}

/**
 * React hook: the digits for 1-based inclusive [start, start+count), or null
 * while any covering bucket is still in flight.
 */
export function useDigitWindow(start: number, count: number): string | null {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const unsubscribe = subscribeDigitWindows(force);
    // Fetching is an effect, not a render side effect; a cached value still
    // renders synchronously below.
    prefetchRange(start, count);
    return unsubscribe;
  }, [start, count]);
  return getCachedRange(start, count);
}

/** Single digit at a 1-based position, or null while loading. */
export function useDigitAt(position: number): string | null {
  const w = useDigitWindow(position, 1);
  return w ? w[0] : null;
}

/**
 * Windowed, render-ready context around a 1-based position (± radius).
 * Returns null while the covering buckets are still loading.
 */
export function useContextAt(position: number | null, length: number, radius = 24): {
  before: string;
  match: string;
  after: string;
} | null {
  const start = position !== null ? Math.max(1, position - radius) : 1;
  const w = useDigitWindow(start, position !== null ? radius + length + radius : 1);
  if (!w || position === null) return null;
  const matchStart = position - start;
  return {
    before: w.slice(Math.max(0, matchStart - radius), matchStart),
    match: w.slice(matchStart, matchStart + length),
    after: w.slice(matchStart + length, matchStart + length + radius),
  };
}

/** One-shot context fetch (PNG export). */
export async function fetchContextAt(position: number, length: number, radius = 24): Promise<{
  before: string;
  match: string;
  after: string;
}> {
  const start = Math.max(1, position - radius);
  const w = await fetchDigitRange(start, radius + length + radius);
  const matchStart = position - start;
  return {
    before: w.slice(Math.max(0, matchStart - radius), matchStart),
    match: w.slice(matchStart, matchStart + length),
    after: w.slice(matchStart + length, matchStart + length + radius),
  };
}

export { BUCKET };
