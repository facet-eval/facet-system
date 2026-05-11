import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createEvaluatorLayerRegistry } from "@facet/core/registries/evaluator-layer-registry.js";
import { createOutputEmitterRegistry } from "@facet/core/registries/output-emitter-registry.js";
import {
  buildAnalysisEmitSchema,
  buildEnvironmentWorkspaceStrategySchema,
  buildEvaluatorLayerSchema,
} from "@facet/core/registries/spec-schemas.js";
import { createWorkspaceStrategyRegistry } from "@facet/core/registries/workspace-strategy-registry.js";
import { defineEvaluatorLayer } from "@facet/sdk/evaluator-layer";
import { defineOutputEmitter } from "@facet/sdk/output-emitter";
import { defineWorkspaceStrategy } from "@facet/sdk/workspace-strategy";
import { loadSpec, SpecLoadError } from "@facet/core/spec/loader.js";

// Bullet 12.3: registry shapes + dynamic spec-schema composition.
//
// These tests pin two contracts:
//
// 1. The eight registries (one per axis) accept registrations and reject
//    duplicates with a clear error.
// 2. `composeExperimentSpecSchema(registries)` produces a schema that
//    accepts whatever the registries declare — including a synthetic
//    custom evaluator layer that doesn't exist in the closed
//    `EvaluatorLayerSchema` of `src/spec/schema.ts`.

describe("Bullet 12.3 — registries", () => {
  describe("evaluator-layer registry", () => {
    it("registers and looks up handlers", () => {
      const registry = createEvaluatorLayerRegistry();
      const oracle = defineEvaluatorLayer({
        id: "oracle_script",
        configSchema: z.object({
          script: z.string().min(1),
          pass_condition: z.string().min(1),
        }),
        async evaluate() {
          return { id: "oracle", passed: true };
        },
      });
      registry.register(oracle);

      expect(registry.has("oracle_script")).toBe(true);
      expect(registry.ids()).toEqual(["oracle_script"]);
      expect(registry.get("oracle_script")).toBe(oracle);
      expect(registry.list()).toEqual([oracle]);
      expect(registry.has("nonexistent")).toBe(false);
    });

    it("throws on duplicate id registration", () => {
      const registry = createEvaluatorLayerRegistry();
      const a = defineEvaluatorLayer({
        id: "dup",
        configSchema: z.object({}),
        async evaluate() {
          return { id: "dup", passed: true };
        },
      });
      registry.register(a);
      expect(() => registry.register(a)).toThrow(/Duplicate registration/);
    });
  });

  describe("buildEvaluatorLayerSchema", () => {
    it("builds a discriminated union over registered handlers", () => {
      const registry = createEvaluatorLayerRegistry();
      registry.register(
        defineEvaluatorLayer({
          id: "oracle_script",
          configSchema: z.object({
            script: z.string().min(1),
            pass_condition: z.string().min(1),
          }),
          async evaluate() {
            return { id: "oracle", passed: true };
          },
        }),
      );
      registry.register(
        defineEvaluatorLayer({
          id: "synthetic_check",
          configSchema: z.object({
            check_name: z.string().min(1),
          }),
          async evaluate() {
            return { id: "synthetic", passed: true };
          },
        }),
      );

      const schema = buildEvaluatorLayerSchema(registry);
      const oracleEntry = schema.parse({
        id: "correctness",
        type: "oracle_script",
        script: "oracle/run.sh",
        pass_condition: "exit_code == 0",
      });
      expect(oracleEntry).toMatchObject({ type: "oracle_script" });

      const syntheticEntry = schema.parse({
        id: "lint",
        type: "synthetic_check",
        check_name: "no-todos",
      });
      expect(syntheticEntry).toMatchObject({ type: "synthetic_check" });

      // Each variant rejects the other's fields by `.strict()`.
      expect(() =>
        schema.parse({
          id: "broken",
          type: "synthetic_check",
          script: "should not be here",
          check_name: "no-todos",
        }),
      ).toThrow();
    });

    it("throws when the registry is empty", () => {
      const registry = createEvaluatorLayerRegistry();
      expect(() => buildEvaluatorLayerSchema(registry)).toThrow(/empty/);
    });
  });

  describe("buildAnalysisEmitSchema", () => {
    it("builds an enum array over registered emitter ids", () => {
      const registry = createOutputEmitterRegistry();
      registry.register(
        defineOutputEmitter({
          id: "results_table_csv",
          async emit() {},
        }),
      );
      registry.register(
        defineOutputEmitter({
          id: "results_table_jsonl",
          async emit() {},
        }),
      );

      const schema = buildAnalysisEmitSchema(registry);
      expect(schema.parse(["results_table_csv"])).toEqual(["results_table_csv"]);
      expect(schema.parse(["results_table_csv", "results_table_jsonl"])).toEqual([
        "results_table_csv",
        "results_table_jsonl",
      ]);
      expect(() => schema.parse([])).toThrow();
      expect(() => schema.parse(["unknown_emitter"])).toThrow();
    });
  });

  describe("buildEnvironmentWorkspaceStrategySchema", () => {
    it("builds an enum over registered workspace strategy ids", () => {
      const registry = createWorkspaceStrategyRegistry();
      registry.register(
        defineWorkspaceStrategy({
          id: "git_worktree",
          async prepare(input) {
            return { path: input.bundlePath, async cleanup() {} };
          },
        }),
      );
      registry.register(
        defineWorkspaceStrategy({
          id: "in_memory",
          async prepare(input) {
            return { path: input.bundlePath, async cleanup() {} };
          },
        }),
      );

      const schema = buildEnvironmentWorkspaceStrategySchema(registry);
      expect(schema.parse("git_worktree")).toBe("git_worktree");
      expect(schema.parse("in_memory")).toBe("in_memory");
      expect(() => schema.parse("not_a_strategy")).toThrow();
    });
  });

  describe("loadSpec(path, registries)", () => {
    let tmp: string;

    beforeEach(async () => {
      tmp = await mkdtemp(path.join(os.tmpdir(), "facet-registries-"));
    });

    afterEach(async () => {
      await rm(tmp, { recursive: true, force: true });
    });

    it("parses a spec that references a synthetic evaluator layer", async () => {
      const evaluatorRegistry = createEvaluatorLayerRegistry();
      evaluatorRegistry.register(
        defineEvaluatorLayer({
          id: "oracle_script",
          configSchema: z.object({
            script: z.string().min(1),
            pass_condition: z.string().min(1),
          }),
          async evaluate() {
            return { id: "oracle", passed: true };
          },
        }),
      );
      evaluatorRegistry.register(
        defineEvaluatorLayer({
          id: "synthetic_check",
          configSchema: z.object({
            check_name: z.string().min(1),
          }),
          async evaluate() {
            return { id: "synthetic", passed: true };
          },
        }),
      );

      const outputEmitterRegistry = createOutputEmitterRegistry();
      outputEmitterRegistry.register(
        defineOutputEmitter({ id: "results_table_csv", async emit() {} }),
      );
      outputEmitterRegistry.register(
        defineOutputEmitter({ id: "results_table_jsonl", async emit() {} }),
      );

      const workspaceRegistry = createWorkspaceStrategyRegistry();
      workspaceRegistry.register(
        defineWorkspaceStrategy({
          id: "git_worktree",
          async prepare(input) {
            return { path: input.bundlePath, async cleanup() {} };
          },
        }),
      );

      const specYaml = `
metadata:
  id: synthetic-001
  name: "Synthetic test"
  description: ""
  version: "0.0.1"
  author: "test"
  seed: 1
  framework_version: "0.1.0"
  harness:
    id: "pi"
    package: "@facet/harness-pi"
    version: "0.70.0"

environment:
  timeout_per_run_seconds: 60
  max_tokens_per_run: 1000
  max_total_cost_usd: 0.01
  workspace_strategy: "git_worktree"

varying_factors:
  - id: prompt_id
    type: prompt_swap
    description: ""
    levels:
      - id: a
  - id: profile
    type: extension_select
    description: ""
    levels:
      - id: default
        ref: "./profile"
        hash: "sha256:00"
  - id: model
    type: model_swap
    description: ""
    levels:
      - id: m
        provider: "openrouter"
        model_id: "google/gemini-2.5-flash-lite"

scenarios:
  - id: s
    ref: "./scenario"
    hash: "sha256:00"

design:
  type: full_factorial
  repetitions: 1
  parallelism: 1

comparisons: []

metrics:
  trace:
    capture:
      - tool_calls
  evaluator:
    layers:
      - id: correctness
        type: oracle_script
        script: "oracle/run.sh"
        pass_condition: "exit_code == 0"
      - id: lint
        type: synthetic_check
        check_name: "no-todos"
  judge: null

analysis:
  type: none
  emit:
    - results_table_csv
`;
      const specPath = path.join(tmp, "spec.yaml");
      await writeFile(specPath, specYaml);

      const result = await loadSpec(specPath, {
        evaluatorLayer: evaluatorRegistry,
        outputEmitter: outputEmitterRegistry,
        workspaceStrategy: workspaceRegistry,
      });

      expect(result.metrics.evaluator.layers.length).toBe(2);
      expect(result.metrics.evaluator.layers[0]?.type).toBe("oracle_script");
      // The synthetic kind comes through as a string; the canonical
      // `ExperimentSpec` type's `type` field is `"oracle_script"` literal,
      // so we read past the type system here intentionally — the runtime
      // shape is what the runner consumes after Phase 12.7.
      expect((result.metrics.evaluator.layers[1] as { type: string }).type).toBe(
        "synthetic_check",
      );
    });

    it("rejects a spec referencing an unregistered evaluator layer kind", async () => {
      const evaluatorRegistry = createEvaluatorLayerRegistry();
      evaluatorRegistry.register(
        defineEvaluatorLayer({
          id: "oracle_script",
          configSchema: z.object({
            script: z.string().min(1),
            pass_condition: z.string().min(1),
          }),
          async evaluate() {
            return { id: "oracle", passed: true };
          },
        }),
      );

      const outputEmitterRegistry = createOutputEmitterRegistry();
      outputEmitterRegistry.register(
        defineOutputEmitter({ id: "results_table_csv", async emit() {} }),
      );

      const workspaceRegistry = createWorkspaceStrategyRegistry();
      workspaceRegistry.register(
        defineWorkspaceStrategy({
          id: "git_worktree",
          async prepare(input) {
            return { path: input.bundlePath, async cleanup() {} };
          },
        }),
      );

      const specYaml = `
metadata:
  id: synthetic-002
  name: "Synthetic test"
  description: ""
  version: "0.0.1"
  author: "test"
  seed: 1
  framework_version: "0.1.0"
  harness:
    id: "pi"
    package: "@facet/harness-pi"
    version: "0.70.0"
environment:
  timeout_per_run_seconds: 60
  max_tokens_per_run: 1000
  max_total_cost_usd: 0.01
  workspace_strategy: "git_worktree"
varying_factors:
  - id: prompt_id
    type: prompt_swap
    description: ""
    levels: [{ id: a }]
  - id: profile
    type: extension_select
    description: ""
    levels: [{ id: d, ref: "./p", hash: "sha256:00" }]
  - id: model
    type: model_swap
    description: ""
    levels: [{ id: m, provider: "openrouter", model_id: "x/y" }]
scenarios:
  - { id: s, ref: "./s", hash: "sha256:00" }
design: { type: full_factorial, repetitions: 1, parallelism: 1 }
comparisons: []
metrics:
  trace: { capture: [tool_calls] }
  evaluator:
    layers:
      - id: bogus
        type: not_a_real_kind
  judge: null
analysis: { type: none, emit: [results_table_csv] }
`;
      const specPath = path.join(tmp, "bad-spec.yaml");
      await writeFile(specPath, specYaml);

      await expect(
        loadSpec(specPath, {
          evaluatorLayer: evaluatorRegistry,
          outputEmitter: outputEmitterRegistry,
          workspaceStrategy: workspaceRegistry,
        }),
      ).rejects.toThrow(SpecLoadError);
    });
  });
});
