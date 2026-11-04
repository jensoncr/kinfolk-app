import { describe, expect, it, vi } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("never exceeds the concurrency limit (in-flight ceiling)", async () => {
    const deferreds: Array<() => void> = [];
    const gate = () => new Promise<void>((resolve) => deferreds.push(resolve));

    let active = 0;
    let maxActive = 0;
    const completed: number[] = [];

    const runPromise = mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate();
        active -= 1;
        completed.push(item);
      },
    );

    // After kicking off, only limit (3) workers should have started
    await Promise.resolve();
    expect(deferreds.length).toBeLessThanOrEqual(3);
    expect(deferreds.length).toBe(3);

    // Flush first wave of 3 — each resolved worker picks up a new item
    deferreds.splice(0, 3).forEach((r) => r());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Still should not exceed limit
    expect(maxActive).toBeLessThanOrEqual(3);

    // Flush remaining deferreds until done
    while (deferreds.length > 0) {
      deferreds.splice(0, deferreds.length).forEach((r) => r());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    await runPromise;

    expect(completed.length).toBe(10);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("preserves result order regardless of completion order", async () => {
    const results = await mapWithConcurrency(
      [10, 20, 30],
      2,
      async (n) => {
        // Deliberately slow the first item so later items finish first
        if (n === 10) {
          await new Promise<void>((r) => setTimeout(r, 5));
        }
        return n * 2;
      },
    );
    expect(results).toEqual([20, 40, 60]);
  });

  it("maps every item exactly once (processed-count parity)", async () => {
    const called: number[] = [];
    const results = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (n) => {
        called.push(n);
        return n * 10;
      },
    );
    expect(results.length).toBe(5);
    expect(called.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("returns [] and never calls mapper for empty input", async () => {
    const fn = vi.fn(async (n: number) => n);
    const results = await mapWithConcurrency([], 4, fn);
    expect(results).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("handles limit >= length (all items run; results in order)", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 10, async (n) => n * 3);
    expect(results).toEqual([3, 6, 9]);
  });

  it("clamps limit < 1 to 1 (runs sequentially, still completes)", async () => {
    const order: number[] = [];
    const results = await mapWithConcurrency(
      [1, 2, 3],
      0,
      async (n) => {
        order.push(n);
        return n;
      },
    );
    expect(results).toEqual([1, 2, 3]);
    // With limit=1 items run sequentially in order
    expect(order).toEqual([1, 2, 3]);
  });
});
