import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { oracleScriptEvaluatorLayer } from "@facet/core/builtins/evaluator-layers/oracle-script.js";
import { resultsTableCsvOutputEmitter } from "@facet/core/builtins/output-emitters/results-table-csv.js";
import { resultsTableJsonlOutputEmitter } from "@facet/core/builtins/output-emitters/results-table-jsonl.js";
import { gitWorktreeWorkspaceStrategy } from "@facet/core/builtins/workspace-strategies/git-worktree.js";
import { createEvaluatorLayerRegistry } from "@facet/core/registries/evaluator-layer-registry.js";
import { createOutputEmitterRegistry } from "@facet/core/registries/output-emitter-registry.js";
import { createWorkspaceStrategyRegistry } from "@facet/core/registries/workspace-strategy-registry.js";
import { defineWorkspaceStrategy } from "@facet/sdk/workspace-strategy";

// Bullet 12.7: SDK builtins for the three remaining axes
// (evaluator-layers, output-emitters, workspace-strategies). The
// production paths in `src/runner/index.ts`, `src/evaluator/oracle.ts`,
// `src/bundle/aggregate.ts`, and `src/workspace/index.ts` stay; this
// bullet adds the registry seams that Phase 13+ flips to.

describe("Bullet 12.7 — evaluator/emit/workspace builtins via registries", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "facet-12-7-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("oracle_script builtin registers cleanly and exposes the expected schema", () => {
    const registry = createEvaluatorLayerRegistry();
    registry.register(oracleScriptEvaluatorLayer);

    expect(registry.has("oracle_script")).toBe(true);
    expect(registry.ids()).toEqual(["oracle_script"]);
    const handler = registry.get("oracle_script");
    expect(handler).toBeDefined();
    expect(
      handler!.configSchema.safeParse({
        script: "oracle/run.sh",
        pass_condition: "exit_code == 0",
      }).success,
    ).toBe(true);
    expect(
      handler!.configSchema.safeParse({
        script: "",
        pass_condition: "exit_code == 0",
      }).success,
    ).toBe(false);
  });

  it("results_table_csv + results_table_jsonl emitters register without conflict", () => {
    const registry = createOutputEmitterRegistry();
    registry.register(resultsTableCsvOutputEmitter);
    registry.register(resultsTableJsonlOutputEmitter);

    expect(registry.ids().sort()).toEqual([
      "results_table_csv",
      "results_table_jsonl",
    ]);
  });

  it("git_worktree builtin registers and exposes the prepare contract", () => {
    const registry = createWorkspaceStrategyRegistry();
    registry.register(gitWorktreeWorkspaceStrategy);

    expect(registry.has("git_worktree")).toBe(true);
    const handler = registry.get("git_worktree");
    expect(handler).toBeDefined();
    expect(typeof handler!.prepare).toBe("function");
  });

  it("registers a synthetic in_memory workspace strategy and dispatches via the registry", async () => {
    const registry = createWorkspaceStrategyRegistry();
    registry.register(gitWorktreeWorkspaceStrategy);

    let prepareCallCount = 0;
    let cleanupCallCount = 0;
    const inMemoryHandler = defineWorkspaceStrategy({
      id: "in_memory",
      configSchema: z.undefined(),
      async prepare(input) {
        prepareCallCount += 1;
        return {
          path: path.join(tmp, "fake-workspace"),
          async cleanup() {
            cleanupCallCount += 1;
          },
        };
      },
    });
    registry.register(inMemoryHandler);

    // Caller-side: the registry dispatcher Phase 13+ will live in
    // `src/workspace/index.ts`; for the bullet's acceptance we exercise
    // the contract directly so the test seam works without rewiring
    // production yet.
    const handler = registry.get("in_memory");
    expect(handler).toBeDefined();
    const handle = await handler!.prepare(
      {
        scenarioPath: path.join(tmp, "scenario"),
        scenarioId: "test",
        codeDir: "repo",
        runId: "run-0001",
        bundlePath: tmp,
      },
      undefined,
    );

    expect(prepareCallCount).toBe(1);
    expect(handle.path).toContain("fake-workspace");
    await handle.cleanup();
    expect(cleanupCallCount).toBe(1);
  });

  it("registry rejects duplicate registration for any of the three axes", () => {
    const evalRegistry = createEvaluatorLayerRegistry();
    evalRegistry.register(oracleScriptEvaluatorLayer);
    expect(() => evalRegistry.register(oracleScriptEvaluatorLayer)).toThrow(
      /Duplicate registration/,
    );

    const emitRegistry = createOutputEmitterRegistry();
    emitRegistry.register(resultsTableCsvOutputEmitter);
    expect(() => emitRegistry.register(resultsTableCsvOutputEmitter)).toThrow(
      /Duplicate registration/,
    );

    const wsRegistry = createWorkspaceStrategyRegistry();
    wsRegistry.register(gitWorktreeWorkspaceStrategy);
    expect(() => wsRegistry.register(gitWorktreeWorkspaceStrategy)).toThrow(
      /Duplicate registration/,
    );
  });
});
