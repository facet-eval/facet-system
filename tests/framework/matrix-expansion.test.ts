import { describe, expect, it } from "vitest";

import { expandMatrix, RunnerError } from "@facet/core/runner/index.js";
import type { ExperimentSpec } from "@facet/core/spec/schema.js";

const baseSpec = (factors: ExperimentSpec["varying_factors"]): ExperimentSpec => ({
  metadata: {
    id: "matrix-test",
    name: "matrix",
    description: "",
    version: "0.1.0",
    author: "test",
    seed: 0,
    framework_version: "0.1.0",
    harness: {
      id: "pi",
      package: "@facet/harness-pi",
      version: "0.70.0",
    },
  },
  environment: {
    timeout_per_run_seconds: 60,
    max_tokens_per_run: 1000,
    max_total_cost_usd: 1,
    workspace_strategy: "git_worktree",
  },
  varying_factors: factors,
  scenarios: [{ id: "s1", ref: "scenarios/s1", hash: "TBD" }],
  design: { type: "full_factorial", repetitions: 1, parallelism: 1 },
  comparisons: [],
  metrics: {
    trace: { capture: ["tool_calls"] },
    evaluator: {
      layers: [
        {
          id: "correctness",
          type: "oracle_script",
          script: "oracle/run.sh",
          pass_condition: "exit_code == 0",
        },
      ],
    },
    judge: null,
  },
  analysis: { type: "none", emit: ["results_table_csv"] },
});

describe("expandMatrix — model_param factor (Phase 6 / F-58)", () => {
  it("includes a harness_params record on each run when a model_param factor is declared", () => {
    const spec = baseSpec([
      {
        id: "prompt_id",
        type: "prompt_swap",
        description: "",
        levels: [{ id: "underspecified" }, { id: "specific" }],
      },
      {
        id: "profile",
        type: "extension_select",
        description: "",
        levels: [{ id: "default", ref: "profiles/default", hash: "TBD" }],
      },
      {
        id: "model",
        type: "model_swap",
        description: "",
        levels: [
          { id: "m1", provider: "openrouter", model_id: "openai/gpt-4o-mini" },
        ],
      },
      {
        id: "temperature",
        type: "model_param",
        param: "temperature",
        description: "",
        levels: [
          { id: "t0", value: 0.0 },
          { id: "t1", value: 0.7 },
          { id: "t2", value: 1.3 },
        ],
      },
    ]);

    // 1 scenario × 2 prompts × 1 profile × 1 model × 3 temperatures × 1 rep = 6
    const entries = expandMatrix(spec);
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.runConfig.runId)).toEqual([
      "run-0001",
      "run-0002",
      "run-0003",
      "run-0004",
      "run-0005",
      "run-0006",
    ]);

    // Within one prompt, all three temperatures should appear in declaration order.
    expect(
      entries.slice(0, 3).map((e) => e.runConfig.harnessParams?.["temperature"]),
    ).toEqual([0.0, 0.7, 1.3]);
    // All entries carry a harnessParams record.
    for (const e of entries) {
      expect(e.runConfig.harnessParams).toBeDefined();
      expect(Object.keys(e.runConfig.harnessParams!)).toEqual(["temperature"]);
    }
  });

  it("omits harness_params when no model_param factor is declared", () => {
    const spec = baseSpec([
      {
        id: "prompt_id",
        type: "prompt_swap",
        description: "",
        levels: [{ id: "p1" }],
      },
      {
        id: "profile",
        type: "extension_select",
        description: "",
        levels: [{ id: "default", ref: "profiles/default", hash: "TBD" }],
      },
      {
        id: "model",
        type: "model_swap",
        description: "",
        levels: [
          { id: "m1", provider: "openrouter", model_id: "openai/gpt-4o-mini" },
        ],
      },
    ]);
    const entries = expandMatrix(spec);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.runConfig.harnessParams).toBeUndefined();
  });

  it("expands the cartesian product of two model_param factors", () => {
    const spec = baseSpec([
      {
        id: "prompt_id",
        type: "prompt_swap",
        description: "",
        levels: [{ id: "p1" }],
      },
      {
        id: "profile",
        type: "extension_select",
        description: "",
        levels: [{ id: "default", ref: "profiles/default", hash: "TBD" }],
      },
      {
        id: "model",
        type: "model_swap",
        description: "",
        levels: [
          { id: "m1", provider: "openrouter", model_id: "openai/gpt-4o-mini" },
        ],
      },
      {
        id: "temperature",
        type: "model_param",
        param: "temperature",
        description: "",
        levels: [
          { id: "t0", value: 0 },
          { id: "t1", value: 1 },
        ],
      },
      {
        id: "top_p_axis",
        type: "model_param",
        param: "top_p",
        description: "",
        levels: [
          { id: "p0", value: 0.5 },
          { id: "p1", value: 0.9 },
        ],
      },
    ]);
    const entries = expandMatrix(spec);
    expect(entries).toHaveLength(4);
    expect(
      entries.map((e) => ({
        t: e.runConfig.harnessParams?.["temperature"],
        p: e.runConfig.harnessParams?.["top_p"],
      })),
    ).toEqual([
      { t: 0, p: 0.5 },
      { t: 0, p: 0.9 },
      { t: 1, p: 0.5 },
      { t: 1, p: 0.9 },
    ]);
  });

  it("propagates spec.metadata.seed and computes a per-run derivedSeed (Phase 7 / Bullet 7.4)", () => {
    const spec = baseSpec([
      {
        id: "prompt_id",
        type: "prompt_swap",
        description: "",
        levels: [{ id: "p1" }, { id: "p2" }],
      },
      {
        id: "profile",
        type: "extension_select",
        description: "",
        levels: [{ id: "default", ref: "profiles/default", hash: "TBD" }],
      },
      {
        id: "model",
        type: "model_swap",
        description: "",
        levels: [
          { id: "m1", provider: "openrouter", model_id: "openai/gpt-4o-mini" },
        ],
      },
    ]);
    const entries = expandMatrix({ ...spec, metadata: { ...spec.metadata, seed: 42 } });
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.runConfig.seed).toBe(42);
      expect(e.runConfig.derivedSeed).toBeDefined();
      expect(Number.isInteger(e.runConfig.derivedSeed)).toBe(true);
    }
    // Distinct run ids ⇒ distinct derivedSeed values.
    expect(entries[0]?.runConfig.derivedSeed).not.toBe(
      entries[1]?.runConfig.derivedSeed,
    );
  });

  it("throws RunnerError when a required factor kind is absent", () => {
    const spec = baseSpec([
      {
        id: "prompt_id",
        type: "prompt_swap",
        description: "",
        levels: [{ id: "p1" }],
      },
      {
        id: "profile",
        type: "extension_select",
        description: "",
        levels: [{ id: "default", ref: "profiles/default", hash: "TBD" }],
      },
      // no model_swap
      {
        id: "temperature",
        type: "model_param",
        param: "temperature",
        description: "",
        levels: [{ id: "t0", value: 0 }],
      },
    ]);
    expect(() => expandMatrix(spec)).toThrow(RunnerError);
  });
});
