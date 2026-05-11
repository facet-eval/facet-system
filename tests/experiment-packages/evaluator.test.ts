import { execSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EvaluatorError,
  evaluateRun,
  parseOracleStdout,
} from "@facet/core/evaluator/index.js";
import { OracleError, runOracle } from "@facet/core/evaluator/oracle.js";
import { loadSpec } from "@facet/core/spec/loader.js";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const fixtureRoot = path.join(repoRoot, "tests/fixtures");
const fixturePackage = path.join(fixtureRoot, "parallel-acceptance");
const compoundPythonScenario = path.join(fixtureRoot, "compound-python");

function hasPython3(): boolean {
  try {
    execSync("python3 --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function makeScenarioWithOracle(scenarioRoot: string, script: string): Promise<void> {
  const oracleDir = path.join(scenarioRoot, "oracle");
  await mkdir(oracleDir, { recursive: true });
  const scriptPath = path.join(oracleDir, "run.sh");
  await writeFile(scriptPath, script, "utf8");
  await chmod(scriptPath, 0o755);
}

describe("runOracle", () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), "facet-evaluator-"));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("reports passed=true when the oracle script exits 0", async () => {
    const scenarioPath = path.join(sandbox, "scenario-pass");
    const workspacePath = path.join(sandbox, "workspace-pass");
    await mkdir(workspacePath, { recursive: true });
    await makeScenarioWithOracle(
      scenarioPath,
      '#!/bin/bash\necho "ok: $1"\nexit 0\n',
    );

    const result = await runOracle(scenarioPath, workspacePath);

    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain(`ok: ${workspacePath}`);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.scriptRelPath).toBe("oracle/run.sh");
  });

  it("reports passed=false with exitCode=1 when the oracle script exits 1", async () => {
    const scenarioPath = path.join(sandbox, "scenario-fail");
    const workspacePath = path.join(sandbox, "workspace-fail");
    await mkdir(workspacePath, { recursive: true });
    await makeScenarioWithOracle(
      scenarioPath,
      '#!/bin/bash\necho "bad things" >&2\nexit 1\n',
    );

    const result = await runOracle(scenarioPath, workspacePath);

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toContain("bad things");
  });

  it("marks timeout without crashing when the script exceeds the budget", async () => {
    const scenarioPath = path.join(sandbox, "scenario-timeout");
    const workspacePath = path.join(sandbox, "workspace-timeout");
    await mkdir(workspacePath, { recursive: true });
    await makeScenarioWithOracle(
      scenarioPath,
      '#!/bin/bash\nsleep 10\n',
    );

    const result = await runOracle(scenarioPath, workspacePath, { timeoutMs: 250 });

    expect(result.timedOut).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(200);
  });

  it("throws OracleError when the script is missing", async () => {
    const scenarioPath = path.join(sandbox, "scenario-missing");
    const workspacePath = path.join(sandbox, "workspace-missing");
    await mkdir(scenarioPath, { recursive: true });
    await mkdir(workspacePath, { recursive: true });

    await expect(runOracle(scenarioPath, workspacePath)).rejects.toBeInstanceOf(
      OracleError,
    );
  });
});

describe("parseOracleStdout", () => {
  it("parses 3/3 task lines and a full regression block", () => {
    const stdout = [
      "[task1] PASS",
      "[task2] PASS",
      "[task3] PASS",
      "[reg1] PASS",
      "[reg2] PASS",
      "[reg3] PASS",
      "[reg4] PASS",
    ].join("\n");
    const parsed = parseOracleStdout(stdout);
    expect(parsed.perTask).toEqual([
      { id: "task1", passed: true },
      { id: "task2", passed: true },
      { id: "task3", passed: true },
    ]);
    expect(parsed.regression).toEqual([
      { id: "reg1", passed: true },
      { id: "reg2", passed: true },
      { id: "reg3", passed: true },
      { id: "reg4", passed: true },
    ]);
  });

  it("parses 2/3 (partial) task lines", () => {
    const stdout = "[task1] PASS\n[task2] FAIL\n[task3] PASS\n";
    const parsed = parseOracleStdout(stdout);
    expect(parsed.perTask.map((t) => t.passed)).toEqual([true, false, true]);
  });

  it("parses 1/3 (partial) task lines", () => {
    const stdout = "[task1] FAIL\n[task2] FAIL\n[task3] PASS\n";
    const parsed = parseOracleStdout(stdout);
    expect(parsed.perTask.filter((t) => t.passed)).toHaveLength(1);
  });

  it("parses 0/3 (cascade) task lines", () => {
    const stdout = "[task1] FAIL\n[task2] FAIL\n[task3] FAIL\n";
    const parsed = parseOracleStdout(stdout);
    expect(parsed.perTask.every((t) => !t.passed)).toBe(true);
    expect(parsed.regression).toHaveLength(0);
  });

  it("ignores malformed and unrelated lines", () => {
    const stdout = [
      "oracle: starting",
      "[task1] PASS",
      "[task2] WARN", // unknown verdict — must be skipped
      "[Task3] PASS", // wrong case — must be skipped
      "[task3] FAIL",
      "  [task4] PASS  ", // trimmed; matches but extends count
      "[reg1] PASS",
    ].join("\n");
    const parsed = parseOracleStdout(stdout);
    expect(parsed.perTask).toEqual([
      { id: "task1", passed: true },
      { id: "task3", passed: false },
      { id: "task4", passed: true },
    ]);
    expect(parsed.regression).toEqual([{ id: "reg1", passed: true }]);
  });

  it("returns empty arrays when no markers are present", () => {
    const parsed = parseOracleStdout("everything looks fine\n");
    expect(parsed.perTask).toHaveLength(0);
    expect(parsed.regression).toHaveLength(0);
  });
});

describe("evaluateRun (compound-python integration)", () => {
  const skip = !hasPython3();
  const test = skip ? it.skip : it;
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), "facet-eval-int-"));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  test(
    "completed_failed: unmodified compound-python repo passes 0/3 task tests",
    async () => {
      const spec = await loadSpec(path.join(fixturePackage, "spec.yaml"));
      const scenarioPath = compoundPythonScenario;
      const workspacePath = path.join(sandbox, "ws-unmodified");
      await cp(path.join(scenarioPath, "repo"), workspacePath, {
        recursive: true,
      });

      const result = await evaluateRun({
        spec,
        runConfig: {
          runId: "run-0001",
          promptId: "underspecified",
          profileId: "default",
          modelLevelId: "gemini-2.5-flash-lite",
          provider: "openrouter",
          modelId: "google/gemini-2.5-flash-lite",
          scenarioId: "compound-python",
          repetition: 1,
        },
        scenarioPath,
        workspacePath,
      });

      expect(result.tasksTotal).toBe(3);
      expect(result.tasksPassed).toBe(0);
      expect(result.perTask.map((t) => t.id)).toEqual(["task1", "task2", "task3"]);
      expect(result.regression.length).toBeGreaterThan(0);
    },
    120_000,
  );

  test(
    "completed_passed: reference_solution passes 3/3 task tests",
    async () => {
      const spec = await loadSpec(path.join(fixturePackage, "spec.yaml"));
      const scenarioPath = compoundPythonScenario;
      const refSolution = path.join(scenarioPath, "reference_solution");
      const workspacePath = path.join(sandbox, "ws-ref");
      await cp(refSolution, workspacePath, { recursive: true });

      const result = await evaluateRun({
        spec,
        runConfig: {
          runId: "run-0002",
          promptId: "underspecified",
          profileId: "default",
          modelLevelId: "gemini-2.5-flash-lite",
          provider: "openrouter",
          modelId: "google/gemini-2.5-flash-lite",
          scenarioId: "compound-python",
          repetition: 1,
        },
        scenarioPath,
        workspacePath,
      });

      expect(result.tasksTotal).toBe(3);
      expect(result.tasksPassed).toBe(3);
      expect(result.perTask.every((t) => t.passed)).toBe(true);
    },
    120_000,
  );
});

describe("evaluateRun hard-fail on malformed oracle", () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), "facet-eval-malformed-"));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("throws EvaluatorError when the oracle emits zero task lines", async () => {
    const spec = await loadSpec(
      path.join(fixturePackage, "spec.yaml"),
    );
    const scenarioPath = path.join(sandbox, "scenario-no-tasks");
    const workspacePath = path.join(sandbox, "ws-no-tasks");
    const oracleDir = path.join(scenarioPath, "oracle");
    await mkdir(oracleDir, { recursive: true });
    await mkdir(workspacePath, { recursive: true });
    const scriptPath = path.join(oracleDir, "run.sh");
    await writeFile(scriptPath, '#!/bin/bash\necho "no markers here"\nexit 0\n', "utf8");
    await chmod(scriptPath, 0o755);

    await expect(
      evaluateRun({
        spec,
        runConfig: {
          runId: "run-0001",
          promptId: "underspecified",
          profileId: "default",
          modelLevelId: "gemini-2.5-flash-lite",
          provider: "openrouter",
          modelId: "google/gemini-2.5-flash-lite",
          scenarioId: "scenario-no-tasks",
          repetition: 1,
        },
        scenarioPath,
        workspacePath,
      }),
    ).rejects.toBeInstanceOf(EvaluatorError);
  });

  it("throws EvaluatorError when the oracle emits 2 task lines instead of 3", async () => {
    const spec = await loadSpec(
      path.join(fixturePackage, "spec.yaml"),
    );
    const scenarioPath = path.join(sandbox, "scenario-two-tasks");
    const workspacePath = path.join(sandbox, "ws-two-tasks");
    const oracleDir = path.join(scenarioPath, "oracle");
    await mkdir(oracleDir, { recursive: true });
    await mkdir(workspacePath, { recursive: true });
    const scriptPath = path.join(oracleDir, "run.sh");
    await writeFile(
      scriptPath,
      '#!/bin/bash\necho "[task1] PASS"\necho "[task2] PASS"\nexit 0\n',
      "utf8",
    );
    await chmod(scriptPath, 0o755);

    await expect(
      evaluateRun({
        spec,
        runConfig: {
          runId: "run-0001",
          promptId: "underspecified",
          profileId: "default",
          modelLevelId: "gemini-2.5-flash-lite",
          provider: "openrouter",
          modelId: "google/gemini-2.5-flash-lite",
          scenarioId: "scenario-two-tasks",
          repetition: 1,
        },
        scenarioPath,
        workspacePath,
      }),
    ).rejects.toThrow(/emitted 2 task line/);
  });
});
