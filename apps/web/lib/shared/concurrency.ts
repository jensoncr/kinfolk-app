/**
 * Maps over `items` running at most `limit` invocations of `mapper` in flight at
 * once. Results are returned in the same order as `items` regardless of
 * completion order. `limit` is clamped to at least 1.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const boundedLimit = Math.max(1, Math.floor(limit));
  let nextIndex = 0;

  const runNext = async (): Promise<void> => {
    if (nextIndex >= items.length) return;
    const index = nextIndex;
    nextIndex += 1;
    results[index] = await mapper(items[index], index);
    return runNext();
  };

  const workers = Array.from(
    { length: Math.min(boundedLimit, items.length) },
    () => runNext(),
  );

  await Promise.all(workers);
  return results;
}
