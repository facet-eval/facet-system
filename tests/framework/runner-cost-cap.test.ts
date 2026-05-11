import { mkdtemp, readFile, rm } from "node:fs/promises";
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

// Fake runSingleRun: writes minimal-but-valid per-run artifacts so the
// manifest writer and aggregated CSV are happy, then returns a deterministic
// RunOutcome with the caller-supplied cost. No Pi, no workspace.
function makeFakeRunSingleRun(
  costPerRunUsd: number,
): (params: RunSingleRunParams) => Promise<RunOutcome> {
  return async (params) => {
    await params.bundleWriter.initRun(params.runConfig);
    await params.bundleWriter.writeRunArtifact(
      params.runConfig.runId,
      "summary.json",
      JSON.stringify(
        {
          run_id: params.runConfig.runId,
          status: "completed_passed",
          duration_ms: 10,
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
          duration_ms: 10,
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
      durationMs: 10,
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
        durationMs: 10,
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

function withCostCap(
  spec: ExperimentSpec,
  capUsd: number,
  opts: { parallelism?: number } = {},
): ExperimentSpec {
  return {
    ...spec,
    environment: { ...spec.environment, max_total_cost_usd: capUsd },
    design: { ...spec.design, parallelism: opts.parallelism ?? spec.design.parallelism },
  };
}

describe("runAll — cost cap (F-29 / G-04)", () => {
  let outDir: string;
  let spec: ExperimentSpec;

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), "facet-cost-cap-"));
    spec = await loadSpec(path.join(FIXTURE_PACKAGE, "spec.yaml"));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("aborts the matrix once cumulative cost crosses max_total_cost_usd, marking later runs BudgetExceededError", async () => {
    // Fixture has 2 prompts × 1 profile × 1 model × 1 scenario × 2 reps = 4 runs.
    // Each run "costs" $0.0006; cap is $0.001. With parallelism=1 the tracker
    // strictly trips after run 2 ($0.0012 cumulative); runs 3-4 are skipped
    // with status="error" / error.name="BudgetExceededError". Parallelism>1
    // would allow up to (parallelism-1) over-shoot runs — covered separately
    // in tests/runner-cost-cap-concurrency.test.ts.
    const costPerRun = 0.0006;
    const cap = 0.001;
    const cappedSpec = withCostCap(spec, cap, { parallelism: 1 });

    const result = await runAll({
      spec: cappedSpec,
      packageRoot: FIXTURE_PACKAGE,
      specPath: path.join(FIXTURE_PACKAGE, "spec.yaml"),
      outputDir: outDir,
      apiKeys: { openrouter: "test-stub-key" },
      runSingleRunFn: makeFakeRunSingleRun(costPerRun),
    });

    expect(result.reports).toHaveLength(4);
    expect(result.abortReason).toBeDefined();
    expect(result.abortReason).toMatch(/^max_total_cost_usd reached: \$0\.0012\d* of \$0\.001000 USD$/);
    expect(result.skippedCount).toBe(2);

    // First two runs completed; last two were skipped.
    const completed = result.reports.filter((r) => r.status === "completed_passed");
    const skipped = result.reports.filter(
      (r) => r.status === "error" && r.error?.name === "BudgetExceededError",
    );
    expect(completed).toHaveLength(2);
    expect(skipped).toHaveLength(2);

    // Aggregated CSV has rows for all 4 runs (the per-bundle "rows = matrix size" contract).
    const csvText = await readFile(path.join(result.bundlePath, "aggregated", "results.csv"), "utf8");
    const dataLines = csvText.trim().split("\n").slice(1);
    expect(dataLines).toHaveLength(4);

    // Skipped runs' summary.json captures the error name.
    for (const skip of skipped) {
      const summaryPath = path.join(
        result.bundlePath,
        "runs",
        skip.runConfig.runId,
        "summary.json",
      );
      const summary = JSON.parse(await readFile(summaryPath, "utf8"));
      expect(summary.status).toBe("error");
      expect(summary.error.name).toBe("BudgetExceededError");
      expect(summary.error.message).toContain("max_total_cost_usd reached");
    }
  });

  it("does NOT abort when cumulative cost stays below the cap", async () => {
    const cappedSpec = withCostCap(spec, 1.0, { parallelism: 1 }); // generous cap
    const result = await runAll({
      spec: cappedSpec,
      packageRoot: FIXTURE_PACKAGE,
      specPath: path.join(FIXTURE_PACKAGE, "spec.yaml"),
      outputDir: outDir,
      apiKeys: { openrouter: "test-stub-key" },
      runSingleRunFn: makeFakeRunSingleRun(0.0001),
    });
    expect(result.abortReason).toBeUndefined();
    expect(result.skippedCount).toBe(0);
    expect(result.reports.every((r) => r.status === "completed_passed")).toBe(true);
  });
});
