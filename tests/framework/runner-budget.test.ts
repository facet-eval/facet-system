import { describe, expect, it } from "vitest";

import {
  assertNoTokenOverflow,
  BudgetExceededError,
  BudgetTracker,
  TokenOverflowError,
} from "@facet/core/runner/budget.js";

describe("BudgetTracker", () => {
  it("does not abort while cumulative cost stays below the cap", () => {
    const t = new BudgetTracker(0.01);
    t.recordRun(0.001);
    t.recordRun(0.002);
    expect(t.aborted).toBe(false);
    expect(t.abortReason).toBeUndefined();
    expect(t.cumulativeCostUsd).toBeCloseTo(0.003, 9);
  });

  it("aborts the moment cumulative cost reaches the cap (>=)", () => {
    const t = new BudgetTracker(0.005);
    t.recordRun(0.002);
    t.recordRun(0.003);
    expect(t.aborted).toBe(true);
    expect(t.abortReason).toMatch(/^max_total_cost_usd reached: \$0\.005000 of \$0\.005000 USD$/);
  });

  it("aborts on overshoot above the cap", () => {
    const t = new BudgetTracker(0.001);
    t.recordRun(0.0007);
    expect(t.aborted).toBe(false);
    t.recordRun(0.0006);
    expect(t.aborted).toBe(true);
    expect(t.cumulativeCostUsd).toBeCloseTo(0.0013, 9);
  });

  it("ignores non-finite or negative cost samples", () => {
    const t = new BudgetTracker(0.001);
    t.recordRun(Number.NaN);
    t.recordRun(-1);
    t.recordRun(Number.POSITIVE_INFINITY);
    expect(t.cumulativeCostUsd).toBe(0);
    expect(t.aborted).toBe(false);
  });

  it("freezes abort state after the first trip — later samples accumulate but do not change the reason", () => {
    const t = new BudgetTracker(0.001);
    t.recordRun(0.0011);
    const reasonAtFirstTrip = t.abortReason;
    t.recordRun(0.0005);
    expect(t.aborted).toBe(true);
    expect(t.abortReason).toBe(reasonAtFirstTrip);
    expect(t.cumulativeCostUsd).toBeCloseTo(0.0016, 9);
  });

  it("buildSkipReason mirrors abortReason once tripped", () => {
    const t = new BudgetTracker(0.001);
    t.recordRun(0.002);
    expect(t.buildSkipReason()).toBe(t.abortReason);
  });
});

describe("assertNoTokenOverflow", () => {
  it("is a no-op when tokens equal the cap", () => {
    expect(() => assertNoTokenOverflow(100, 100, "run-0001")).not.toThrow();
  });

  it("is a no-op below the cap", () => {
    expect(() => assertNoTokenOverflow(50, 100, "run-0001")).not.toThrow();
  });

  it("throws TokenOverflowError above the cap, naming the run id and totals", () => {
    expect(() => assertNoTokenOverflow(150, 100, "run-0007")).toThrow(TokenOverflowError);
    try {
      assertNoTokenOverflow(150, 100, "run-0007");
    } catch (err) {
      expect((err as Error).name).toBe("TokenOverflowError");
      expect((err as Error).message).toContain("run-0007");
      expect((err as Error).message).toContain("150");
      expect((err as Error).message).toContain("100");
    }
  });
});

describe("error class identity", () => {
  it("BudgetExceededError carries the right name", () => {
    const e = new BudgetExceededError("hello");
    expect(e.name).toBe("BudgetExceededError");
    expect(e.message).toBe("hello");
    expect(e instanceof Error).toBe(true);
  });

  it("TokenOverflowError carries the right name", () => {
    const e = new TokenOverflowError("hi");
    expect(e.name).toBe("TokenOverflowError");
    expect(e instanceof Error).toBe(true);
  });
});
