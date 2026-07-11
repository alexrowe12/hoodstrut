export type PoolResult<R> =
  | { ok: true; value: R }
  | { ok: false; error: Error };

/**
 * Run an async function over items with at most `limit` concurrent
 * executions. Results preserve input order. A rejection is captured
 * as a settled error result and never aborts the other items.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PoolResult<R>[]> {
  if (items.length === 0) {
    return [];
  }

  const effectiveLimit = Math.max(1, Math.min(Math.floor(limit), items.length));
  const results: PoolResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        const value = await fn(items[index], index);
        results[index] = { ok: true, value };
      } catch (error) {
        results[index] = {
          ok: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    }
  }

  const workers = Array.from({ length: effectiveLimit }, () => worker());
  await Promise.all(workers);

  return results;
}
