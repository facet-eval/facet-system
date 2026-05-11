// Bounded promise pool used by `runAll` to execute matrix entries
// concurrently while respecting `spec.design.parallelism`. The pool itself
// is intentionally minimal: each worker is expected to capture its own
// errors (mirroring the per-run try/catch in `runAll`); any leak is
// swallowed here so one buggy worker cannot abort the rest of the pool.
//
// Order of completion is not order of submission. Callers that need
// deterministic ordering (e.g. building the manifest run list) must index
// into a pre-sized result array using the `index` argument passed to the
// worker, not push as completions arrive.
export async function runWithLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const total = items.length;
  if (total === 0) return;
  const concurrency = Math.max(1, Math.min(Math.floor(limit), total));
  let cursor = 0;
  const lanes: Promise<void>[] = [];
  for (let lane = 0; lane < concurrency; lane += 1) {
    lanes.push(
      (async () => {
        while (true) {
          const i = cursor;
          cursor += 1;
          if (i >= total) return;
          const item = items[i];
          if (item === undefined) continue;
          try {
            await worker(item, i);
          } catch {
            // Pool contract: workers are responsible for capturing their
            // own errors. Swallow any leak so the rest of the pool drains.
          }
        }
      })(),
    );
  }
  await Promise.all(lanes);
}
