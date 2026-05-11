import { describe, expect, it } from "vitest";

import type { EvaluationResult } from "@facet/core/evaluator/index.js";
import { buildTestsJson, deriveStatus } from "@facet/core/runner/index.js";

describe("deriveStatus", () => {
  const base = {
    sessionTimedOut: false,
    oracleTimedOut: false,
    tasksPassed: 0,
    tasksTotal: 3,
    hardError: false,
  };

  it("returns error when hardError is set, regardless of other fields", () => {
    expect(
      deriveStatus({ ...base, hardError: true, sessionTimedOut: true, tasksPassed: 3 }),
    ).toBe("error");
  });

  it("returns timeout when the session timed out", () => {
    expect(deriveStatus({ ...base, sessionTimedOut: true })).toBe("timeout");
  });

  it("returns timeout when the oracle itself timed out", () => {
    expect(deriveStatus({ ...base, oracleTimedOut: true })).toBe("timeout");
  });

  it("returns completed_passed when all tasks pass", () => {
    expect(deriveStatus({ ...base, tasksPassed: 3, tasksTotal: 3 })).toBe(
      "completed_passed",
    );
  });

  it("returns completed_failed when zero tasks pass", () => {
    expect(deriveStatus({ ...base, tasksPassed: 0, tasksTotal: 3 })).toBe(
      "completed_failed",
    );
  });

  it("returns partially_completed when 1 of 3 tasks pass", () => {
    expect(deriveStatus({ ...base, tasksPassed: 1, tasksTotal: 3 })).toBe(
      "partially_completed",
    );
  });

  it("returns partially_completed when 2 of 3 tasks pass", () => {
    expect(deriveStatus({ ...base, tasksPassed: 2, tasksTotal: 3 })).toBe(
      "partially_completed",
    );
  });

  it("prioritizes timeout over partial outcome", () => {
    expect(
      deriveStatus({
        ...base,
        sessionTimedOut: true,
        tasksPassed: 2,
        tasksTotal: 3,
      }),
    ).toBe("timeout");
  });

  it("prioritizes error over timeout", () => {
    expect(
      deriveStatus({
        ...base,
        hardError: true,
        oracleTimedOut: true,
        tasksPassed: 1,
        tasksTotal: 3,
      }),
    ).toBe("error");
  });
});

describe("buildTestsJson v2 shape", () => {
  it("produces a document matching the v2 schema (snapshot)", () => {
    const evaluation: EvaluationResult = {
      runId: "run-0001",
      passed: false,
      exitCode: 1,
      durationMs: 4321,
      timedOut: false,
      perTask: [
        { id: "task1", passed: true },
        { id: "task2", passed: false },
        { id: "task3", passed: false },
      ],
      regression: [
        { id: "reg1", passed: true },
        { id: "reg2", passed: false },
      ],
      tasksTotal: 3,
      tasksPassed: 1,
      regressionTotal: 2,
      regressionPassed: 1,
      layers: [
        {
          id: "correctness",
          type: "oracle_script",
          passed: false,
          exitCode: 1,
          durationMs: 4321,
          timedOut: false,
          stdout: "[task1] PASS\n[task2] FAIL\n[task3] FAIL\n",
          stderr: "",
        },
      ],
    };

    const doc = buildTestsJson(evaluation);

    expect(doc).toMatchInlineSnapshot(`
      {
        "duration_ms": 4321,
        "exit_code": 1,
        "layers": [
          {
            "durationMs": 4321,
            "exitCode": 1,
            "id": "correctness",
            "passed": false,
            "stderr": "",
            "stdout": "[task1] PASS
      [task2] FAIL
      [task3] FAIL
      ",
            "timedOut": false,
            "type": "oracle_script",
          },
        ],
        "passed": false,
        "per_task": [
          {
            "id": "task1",
            "passed": true,
          },
          {
            "id": "task2",
            "passed": false,
          },
          {
            "id": "task3",
            "passed": false,
          },
        ],
        "regression": [
          {
            "id": "reg1",
            "passed": true,
          },
          {
            "id": "reg2",
            "passed": false,
          },
        ],
        "regression_tests_passed": 1,
        "regression_tests_total": 2,
        "run_id": "run-0001",
        "tasks_passed": 1,
        "tasks_total": 3,
        "timed_out": false,
        "version": "v2",
      }
    `);
  });
});
