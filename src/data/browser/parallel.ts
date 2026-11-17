/**
 * Bounded-concurrency async map, used to load dataset chunks in parallel.
 *
 * A full 1B search needs 100 x 5 MB chunks. Loading them one at a time pays
 * 100 round trips; loading all 100 at once would open 100 fetches and 100
 * IndexedDB reads. This caps in-flight work at a small constant while keeping
 * callbacks and results in input order.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };

  // Promise.all attaches a handler to every worker, so a rejection cannot
  // become an unhandled rejection even if later workers are still running.
  await Promise.all(Array.from({ length: workers }, runWorker));
  return results;
}
