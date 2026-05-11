import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_TASK_IDS,
  evaluateRun,
  expectedTaskIds,
  parseOracleStdout,
} from "@facet/core/evaluator/index.js";
import {
  createGitWorktree,
  prepareScenarioRepo,
  destroyWorkspace,
  generateWorkspaceId,
  WorkspaceError,
  SCENARIO_PATH_DENYLIST,
} from "@facet/core/workspace/index.js";
import { ScenarioMetaSchema, type ExperimentSpec } from "@facet/core/spec/schema.js";

const baseSpec = (oracleScript: string = "oracle/run.sh"): ExperimentSpec => ({
  metadata: {
    id: "scenario-shape-test",
    name: "scenario-shape",
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
  varying_factors: [
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
      levels: [{ id: "default", ref: "p", hash: "TBD" }],
    },
    {
      id: "model",
      type: "model_swap",
      description: "",
      levels: [
        { id: "m1", provider: "openrouter", model_id: "openai/gpt-4o-mini" },
      ],
    },
  ],
  scenarios: [{ id: "synthetic", ref: "scenarios/synthetic", hash: "TBD" }],
  design: { type: "full_factorial", repetitions: 1, parallelism: 1 },
  comparisons: [],
  metrics: {
    trace: { capture: ["tool_calls"] },
    evaluator: {
      layers: [
        {
          id: "correctness",
          type: "oracle_script",
          script: oracleScript,
          pass_condition: "exit_code == 0",
        },
      ],
    },
    judge: null,
  },
  analysis: { type: "none", emit: ["results_table_csv"] },
});

describe("expectedTaskIds (Phase 8 / Bullet 8.1)", () => {
  it("returns the framework default when meta.task_ids is absent", () => {
    const meta = ScenarioMetaSchema.parse({
      id: "demo",
      prompts: [{ id: "p1", file: "p1.md" }],
    });
    expect(expectedTaskIds(meta)).toEqual(DEFAULT_TASK_IDS);
  });

  it("returns the scenario-declared ids when meta.task_ids is set", () => {
    const meta = ScenarioMetaSchema.parse({
      id: "demo",
      prompts: [{ id: "p1", file: "p1.md" }],
      task_ids: ["fix_off_by_one", "add_iterator", "rename_field", "tighten_test", "extract_module"],
    });
    expect(expectedTaskIds(meta)).toEqual([
      "fix_off_by_one",
      "add_iterator",
      "rename_field",
      "tighten_test",
      "extract_module",
    ]);
  });
});

describe("parseOracleStdout with custom task ids (Phase 8 / Bullet 8.1)", () => {
  it("collects only declared ids and ignores foreign markers", () => {
    const stdout = [
      "[fix_off_by_one] PASS",
      "[unknown_marker] PASS", // not in expected set — must be ignored
      "[add_iterator] FAIL",
      "[reg1] PASS",
    ].join("\n");
    const result = parseOracleStdout(stdout, ["fix_off_by_one", "add_iterator"]);
    expect(result.perTask).toEqual([
      { id: "fix_off_by_one", passed: true },
      { id: "add_iterator", passed: false },
    ]);
    expect(result.regression).toEqual([{ id: "reg1", passed: true }]);
  });

  it("supports 5-task scenarios", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const stdout = ids.map((id, i) => `[${id}] ${i % 2 === 0 ? "PASS" : "FAIL"}`).join("\n");
    const result = parseOracleStdout(stdout, ids);
    expect(result.perTask).toHaveLength(5);
    expect(result.perTask.filter((t) => t.passed)).toHaveLength(3);
  });
});

describe("SCENARIO_PATH_DENYLIST (Phase 8 / Bullet 8.5)", () => {
  it("includes reference_solution by default", () => {
    expect(SCENARIO_PATH_DENYLIST).toContain("reference_solution");
  });

  it("refuses to prepare a scenario repo at a denylisted code_dir", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "facet-deny-"));
    try {
      await mkdir(path.join(tmp, "reference_solution"), { recursive: true });
      await expect(prepareScenarioRepo(tmp, "reference_solution")).rejects.toThrow(
        WorkspaceError,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("Phase 8 — scenario with code_dir and 5 task_ids (end-to-end oracle)", () => {
  let sandbox: string;
  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), "facet-scenario-shape-"));
  });
  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("runs the oracle from a custom code_dir ('src'), honors a custom script path, and accepts 5 declared task ids", async () => {
    const scenarioPath = path.join(sandbox, "scenario");
    const srcDir = path.join(scenarioPath, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(path.join(srcDir, "hello.txt"), "hello\n", "utf8");

    // Custom oracle script path: oracle/check.sh (not the default run.sh).
    const oracleDir = path.join(scenarioPath, "oracle");
    await mkdir(oracleDir, { recursive: true });
    const oraclePath = path.join(oracleDir, "check.sh");
    await writeFile(
      oraclePath,
      `#!/bin/sh
echo "[fix_off_by_one] PASS"
echo "[add_iterator] PASS"
echo "[rename_field] FAIL"
echo "[tighten_test] PASS"
echo "[extract_module] PASS"
echo "[reg1] PASS"
exit 0
`,
      "utf8",
    );
    execFileSync("chmod", ["+x", oraclePath]);

    // Set up the scenario repo from src/ (not the default repo/).
    const repoPath = await prepareScenarioRepo(scenarioPath, "src");
    expect(path.basename(repoPath)).toBe("src");

    // Workspace strategy dispatcher — bullet 16.1 routed this through
    // the workspace-strategy registry. The builtin `git_worktree`
    // handler internally calls `prepareScenarioRepo + createGitWorktree`;
    // tests that exercise the low-level helpers go via
    // `createGitWorktree` directly.
    const workspaceId = generateWorkspaceId();
    const workspacePath = await createGitWorktree(repoPath, workspaceId);
    try {
      const spec = baseSpec("oracle/check.sh");
      const taskIds = [
        "fix_off_by_one",
        "add_iterator",
        "rename_field",
        "tighten_test",
        "extract_module",
      ];
      const evaluation = await evaluateRun({
        spec,
        runConfig: {
          runId: "run-0001",
          promptId: "p1",
          profileId: "default",
          modelLevelId: "m1",
          provider: "openrouter",
          modelId: "openai/gpt-4o-mini",
          scenarioId: "synthetic",
          repetition: 1,
        },
        scenarioPath,
        workspacePath,
        expectedTaskIds: taskIds,
      });
      expect(evaluation.tasksTotal).toBe(5);
      expect(evaluation.tasksPassed).toBe(4); // one FAIL
      expect(evaluation.perTask.map((t) => t.id)).toEqual(taskIds);
      expect(evaluation.regression).toEqual([{ id: "reg1", passed: true }]);
      expect(evaluation.layers[0]?.id).toBe("correctness");
    } finally {
      await destroyWorkspace(workspacePath);
    }
  }, 30_000);
});

// Sanity: round-trips ScenarioMetaSchema with the two new optional fields.
describe("ScenarioMetaSchema (Phase 8 / Bullets 8.1, 8.3)", () => {
  it("accepts task_ids and code_dir as optional fields", () => {
    const yamlText = `id: demo
prompts:
  - id: p1
    file: p1.md
task_ids: ["a", "b"]
code_dir: src
`;
    const parsed = ScenarioMetaSchema.parse(parseYaml(yamlText));
    expect(parsed.task_ids).toEqual(["a", "b"]);
    expect(parsed.code_dir).toBe("src");
  });
});
