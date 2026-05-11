import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Layer2Metrics } from "@facet/core/evaluator/layer2.js";
import { runAll, type RunOutcome, type RunSingleRunParams } from "@facet/core/runner/index.js";
import { loadSpec } from "@facet/core/spec/loader.js";
import type { ExperimentSpec } from "@facet/core/spec/schema.js";

const FIXTURE_PACKAGE = path.resolve(
  __dirname, "..",
  "fixtures",
  "parallel-acceptance",
);

function emptyLayer2(): Layer2Metrics {
  return {
    tool_calls_total: 0,
    tool_calls_per_type: {},
    files_read_unique: 0,
    turns_to_first_edit: null,
    repeated_file_edits: 0,
    clarification_requests_count: 0,
    bash_commands_count: 0,
    graph_queries_count: 0,
    rag_searches_count: 0,
    lsp_queries_count: 0,
    lens_warnings_received: 0,
    subagent_invocations_count: 0,
    subagent_max_depth: 0,
    tokens_in_total: 0,
    tokens_out_total: 0,
    tokens_in_upfront: 0,
    context_window_size: 0,
    context_utilization_max_pct: 0,
    context_utilization_avg_pct: 0,
  };
}

// Same shape as the cost-cap test, but each fake run waits `delayMs` so we
// can observe how the tracker abort interacts with parallel workers.
function makeDelayedFakeRunSingleRun(
  costPerRunUsd: number,
  delayMs: number,
): (params: RunSingleRunParams) => Promise<RunOutcome> {
  return async (params) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await params.bundleWriter.initRun(params.runConfig);
    await params.bundleWriter.writeRunArtifact(
      params.runConfig.runId,
      "summary.json",
      JSON.stringify(
        {
          run_id: params.runConfig.runId,
          status: "completed_passed",
          duration_ms: delayMs,
          tokens_in: 10,
          tokens_out: 10,
          tokens_total: 20,
          cost_usd: costPerRunUsd,
          tasks_completed: 3,
          tasks_total: 3,
        },
        null,
        2,
      ) + "\n",
    );
    await params.bundleWriter.writeRunArtifact(
      params.runConfig.runId,
      "tests.json",
      JSON.stringify(
        {
          version: "v2",
          run_id: params.runConfig.runId,
          passed: true,
          exit_code: 0,
          duration_ms: delayMs,
          timed_out: false,
          tasks_total: 3,
          tasks_passed: 3,
          tasks_completed: 3,
          regression_tests_total: 0,
          regression_tests_passed: 0,
          per_task: [],
          regression: [],
          layers: [],
        },
        null,
        2,
      ) + "\n",
    );
    await params.bundleWriter.writeRunArtifact(
      params.runConfig.runId,
      "metrics.json",
      JSON.stringify(emptyLayer2(), null, 2) + "\n",
    );
    await params.bundleWriter.finalizeRun(params.runConfig.runId);

    return {
      runId: params.runConfig.runId,
      promptId: params.runConfig.promptId,
      scenarioId: params.runConfig.scenarioId,
      profileId: params.runConfig.profileId,
      modelLevelId: params.runConfig.modelLevelId,
      durationMs: delayMs,
      timedOut: false,
      eventCount: 0,
      tokensIn: 10,
      tokensOut: 10,
      tokensTotal: 20,
      costUsd: costPerRunUsd,
      clarificationRequestsCount: 0,
      finalMessage: undefined,
      evaluation: {
        runId: params.runConfig.runId,
        passed: true,
        exitCode: 0,
        durationMs: delayMs,
        timedOut: false,
        perTask: [],
        regression: [],
        tasksTotal: 3,
        tasksPassed: 3,
        regressionTotal: 0,
        regressionPassed: 0,
        layers: [],
      },
      layer2: emptyLayer2(),
    };
  };
}

function withOverrides(
  spec: ExperimentSpec,
  capUsd: number,
  parallelism: number,
): ExperimentSpec {
  return {
    ...spec,
    environment: { ...spec.environment, max_total_cost_usd: capUsd },
    design: { ...spec.design, parallelism },
  };
}

describe("runAll — cost cap under parallelism (over-shoot bound)", () => {
  let outDir: string;
  let spec: ExperimentSpec;

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), "facet-cost-cap-par-"));
    spec = await loadSpec(path.join(FIXTURE_PACKAGE, "spec.yaml"));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("under parallelism=2, the cap fires and over-shoot stays within parallelism-1 extras past the trip", async () => {
    // 4 runs, parallelism 2. Each run costs $0.0006, cap is $0.0007.
    //
    // Pool launches runs 1-2 simultaneously. Whichever finishes first
    // records $0.0006 (still under cap); pool starts run 3 in the freed
    // slot. The other in-flight run then finishes, reporting $0.0012
    // (>= cap, tracker trips). Run 3 is already past the pre-flight
    // gate and will commit ($0.0018); run 4 sees the tripped tracker
    // and is skipped. So at most (parallelism-1)=1 extra runs commit
    // past the trip — matching the architecture-doc R3 bound.
    const cappedSpec = withOverrides(spec, 0.0007, 2);

    const result = await runAll({
      spec: cappedSpec,
      packageRoot: FIXTURE_PACKAGE,
      specPath: path.join(FIXTURE_PACKAGE, "spec.yaml"),
      outputDir: outDir,
      apiKeys: { openrouter: "test-stub-key" },
      runSingleRunFn: makeDelayedFakeRunSingleRun(0.0006, 30),
    });

    expect(result.reports).toHaveLength(4);
    expect(result.abortReason).toBeDefined();

    const completed = result.reports.filter((r) => r.status === "completed_passed").length;
    const skipped = result.reports.filter(
      (r) => r.error?.name === "BudgetExceededError",
    ).length;
    expect(completed + skipped).toBe(4);

    // Trip happens after exactly 2 runs ($0.0012 >= $0.0007). Without
    // overshoot, completed == 2. With parallelism = 2 the bound is
    // 2 + (parallelism - 1) = 3. Skipped is the complement.
    const tripAfterRuns = 2;
    const maxOverShoot = cappedSpec.design.parallelism - 1;
    expect(completed).toBeLessThanOrEqual(tripAfterRuns + maxOverShoot);
    expect(completed).toBeGreaterThanOrEqual(tripAfterRuns);
    expect(skipped).toBeGreaterThanOrEqual(1);
    expect(result.skippedCount).toBe(skipped);
  });
});
