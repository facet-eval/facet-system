import { describe, expect, it } from "vitest";

import { runWithLimit } from "@facet/core/runner/pool.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runWithLimit", () => {
  it("processes every item exactly once", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const seen = new Set<number>();
    await runWithLimit(items, 3, async (item, index) => {
      expect(items[index]).toBe(item);
      seen.add(item);
    });
    expect(seen.size).toBe(items.length);
    for (const i of items) expect(seen.has(i)).toBe(true);
  });

  it("respects the concurrency bound", async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;
    await runWithLimit(items, 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(15);
      inFlight -= 1;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // sanity: some overlap actually happened
  });

  it("isolates worker errors so the rest of the pool drains", async () => {
    const items = [0, 1, 2, 3, 4];
    const completed: number[] = [];
    await runWithLimit(items, 2, async (item) => {
      if (item === 2) {
        throw new Error("worker boom");
      }
      completed.push(item);
    });
    expect(completed.sort((a, b) => a - b)).toEqual([0, 1, 3, 4]);
  });

  it("returns immediately for an empty item list", async () => {
    let called = false;
    await runWithLimit<number>([], 4, async () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  it("handles limit greater than item count", async () => {
    const items = [0, 1, 2];
    const seen: number[] = [];
    await runWithLimit(items, 10, async (item) => {
      seen.push(item);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("clamps non-positive limits to 1", async () => {
    const items = [0, 1, 2];
    let inFlight = 0;
    let maxInFlight = 0;
    await runWithLimit(items, 0, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight -= 1;
    });
    expect(maxInFlight).toBe(1);
  });

  it("achieves parallel speedup over serial execution", async () => {
    const itemCount = 4;
    const workMs = 200;
    const items = Array.from({ length: itemCount }, (_, i) => i);
    const startedAt = Date.now();
    await runWithLimit(items, 2, async () => {
      await delay(workMs);
    });
    const elapsed = Date.now() - startedAt;
    // Serial estimate: itemCount * workMs. Parallel at p=2 should land near
    // (itemCount / 2) * workMs. The bullet's sanity threshold is 0.7 of serial.
    expect(elapsed).toBeLessThan(itemCount * workMs * 0.7);
    expect(elapsed).toBeGreaterThanOrEqual(workMs);
  });

  it("produces report-shaped output when callers index into a pre-sized array", async () => {
    // Mirrors the runner's pattern: out-of-order completions land in
    // submission-order slots so the manifest list stays deterministic.
    const items = ["a", "b", "c", "d", "e"];
    const slots: (string | undefined)[] = new Array(items.length).fill(undefined);
    await runWithLimit(items, 3, async (item, idx) => {
      // Reverse the natural completion order so writes are clearly out-of-order.
      await delay((items.length - idx) * 5);
      slots[idx] = item.toUpperCase();
    });
    expect(slots).toEqual(["A", "B", "C", "D", "E"]);
  });
});
