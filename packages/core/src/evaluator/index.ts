import type { RunConfig } from "../bundle/writer.js";
import type { ExperimentSpec, ScenarioMeta } from "../spec/schema.js";

import { runOracle, type OracleResult } from "./oracle.js";

export { runOracle, OracleError } from "./oracle.js";
export type { OracleResult } from "./oracle.js";

export class EvaluatorError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EvaluatorError";
  }
}

// Phase 10 / Bullet 10.6 — F-53. Hard cap on captured stdout/stderr so a
// scenario whose oracle emits 100MB of test output does not bloat
// tests.json to the point of breaking downstream JSON parsers. The
// truncation marker is a single appended line so a downstream reader
// can detect it programmatically.
export const STREAM_CAPTURE_CAP_BYTES = 10 * 1024 * 1024;

export function capCapturedStream(
  raw: string,
  capBytes: number = STREAM_CAPTURE_CAP_BYTES,
): string {
  if (raw.length <= capBytes) return raw;
  const truncatedBytes = raw.length - capBytes;
  return (
    raw.slice(0, capBytes) +
    `\n[truncated ${truncatedBytes} additional bytes]\n`
  );
}

// Phase 8 / Bullet 8.1 — F-36. The scenario owns its expected task ids.
// The legacy ["task1", "task2", "task3"] set survives as the default so a
// scenario without `meta.yaml.task_ids` keeps working unchanged.
export const DEFAULT_TASK_IDS: readonly string[] = ["task1", "task2", "task3"];

export function expectedTaskIds(meta: ScenarioMeta): readonly string[] {
  return meta.task_ids ?? DEFAULT_TASK_IDS;
}

// Legacy parser: `[taskN]` only (back-compat with pre-Phase-8 scenarios
// that did not declare `meta.yaml.task_ids`). Active when no expected-id
// set is supplied. Keeps regression markers a separate, narrower regex.
const LEGACY_TASK_LINE_RE = /^\[(task\d+)\]\s+(PASS|FAIL)$/;
// Flexible parser: any `[<id>] (PASS|FAIL)` with the id drawn from the
// scenario-declared `task_ids` set. Active when an expected-id set is
// supplied. Regression markers are checked first so `[reg1]` never gets
// mis-classified as a task line.
const FLEXIBLE_TASK_LINE_RE = /^\[([A-Za-z0-9_\-.]+)\]\s+(PASS|FAIL)$/;
const REGRESSION_LINE_RE = /^\[reg(\d+)\]\s+(PASS|FAIL)$/;

export interface OracleTaskResult {
  readonly id: string;
  readonly passed: boolean;
}

export interface ParsedOracleOutput {
  readonly perTask: readonly OracleTaskResult[];
  readonly regression: readonly OracleTaskResult[];
}

/**
 * Parse oracle stdout into per-task + regression results. When
 * `expectedIds` is supplied, only `[<id>]` markers from that set are
 * collected into the perTask list (the order in the output is preserved;
 * the count check is the caller's job). Regression markers (`[regN]`)
 * are collected regardless. Phase 8 / F-36 — task ids are now scenario-
 * declared, not framework-hardcoded; passing the set in keeps the
 * parser closed to typos in the oracle output.
 */
export function parseOracleStdout(
  stdout: string,
  expectedIds?: readonly string[],
): ParsedOracleOutput {
  const perTask: OracleTaskResult[] = [];
  const regression: OracleTaskResult[] = [];
  const expectedSet =
    expectedIds !== undefined ? new Set(expectedIds) : undefined;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    // Regression markers first — flexible parser would otherwise mis-claim
    // `[reg1] PASS` as a task line.
    const regMatch = REGRESSION_LINE_RE.exec(line);
    if (regMatch !== null) {
      regression.push({ id: `reg${regMatch[1]}`, passed: regMatch[2] === "PASS" });
      continue;
    }
    if (expectedSet !== undefined) {
      const taskMatch = FLEXIBLE_TASK_LINE_RE.exec(line);
      if (taskMatch !== null && expectedSet.has(taskMatch[1]!)) {
        perTask.push({ id: taskMatch[1]!, passed: taskMatch[2] === "PASS" });
      }
    } else {
      const taskMatch = LEGACY_TASK_LINE_RE.exec(line);
      if (taskMatch !== null) {
        perTask.push({ id: taskMatch[1]!, passed: taskMatch[2] === "PASS" });
      }
    }
  }
  return { perTask, regression };
}

export interface EvaluationLayerResult {
  readonly id: string;
  readonly type: "oracle_script";
  readonly passed: boolean;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface EvaluationResult {
  readonly runId: string;
  readonly passed: boolean;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly perTask: readonly OracleTaskResult[];
  readonly regression: readonly OracleTaskResult[];
  readonly tasksTotal: number;
  readonly tasksPassed: number;
  readonly regressionTotal: number;
  readonly regressionPassed: number;
  readonly layers: readonly EvaluationLayerResult[];
}

export interface EvaluateRunParams {
  readonly spec: ExperimentSpec;
  readonly runConfig: RunConfig;
  readonly scenarioPath: string;
  readonly workspacePath: string;
  readonly timeoutMs?: number;
  // Phase 8 / Bullet 8.1 — F-36. The runner threads the scenario's
  // declared `meta.yaml.task_ids` here (or the framework default when
  // absent). The evaluator parses against this set and validates that
  // a finished oracle emits exactly these ids.
  readonly expectedTaskIds?: readonly string[];
}

export async function evaluateRun(params: EvaluateRunParams): Promise<EvaluationResult> {
  const { spec, runConfig, scenarioPath, workspacePath, timeoutMs } = params;
  const taskIds = params.expectedTaskIds ?? DEFAULT_TASK_IDS;

  const oracleLayer = spec.metrics.evaluator.layers.find(
    (layer) => layer.type === "oracle_script",
  );
  if (oracleLayer === undefined) {
    throw new EvaluatorError(
      "Spec does not declare any evaluator layer of type \"oracle_script\"",
    );
  }

  // Phase 8 / Bullet 8.2 — F-37. Thread the spec-declared `script` into
  // the oracle runner. Defaults to `oracle/run.sh` when unset (preserved
  // inside `runOracle`).
  const oracle: OracleResult = await runOracle(scenarioPath, workspacePath, {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    scriptRelPath: oracleLayer.script,
  });

  const parsed = parseOracleStdout(oracle.stdout, taskIds);
  const tasksTotal = parsed.perTask.length;
  const tasksPassed = parsed.perTask.reduce((n, t) => n + (t.passed ? 1 : 0), 0);
  const regressionTotal = parsed.regression.length;
  const regressionPassed = parsed.regression.reduce(
    (n, t) => n + (t.passed ? 1 : 0),
    0,
  );

  // A finished compound oracle must emit exactly the declared task ids
  // (study-design §7.1). A mismatch is a malformed oracle and a hard-stop
  // signal — silent coercion would corrupt the primary outcome metric.
  // Oracle timeouts are exempt: their stdout is partial by design.
  if (!oracle.timedOut && tasksTotal !== taskIds.length) {
    throw new EvaluatorError(
      `Oracle for scenario "${runConfig.scenarioId}" emitted ${tasksTotal} task line(s), expected ${taskIds.length} (${taskIds.join(", ")})`,
    );
  }

  const layerResult: EvaluationLayerResult = {
    id: oracleLayer.id,
    type: "oracle_script",
    passed: oracle.passed,
    exitCode: oracle.exitCode,
    durationMs: oracle.durationMs,
    timedOut: oracle.timedOut,
    stdout: capCapturedStream(oracle.stdout),
    stderr: capCapturedStream(oracle.stderr),
  };

  return {
    runId: runConfig.runId,
    passed: oracle.passed,
    exitCode: oracle.exitCode,
    durationMs: oracle.durationMs,
    timedOut: oracle.timedOut,
    perTask: parsed.perTask,
    regression: parsed.regression,
    tasksTotal,
    tasksPassed,
    regressionTotal,
    regressionPassed,
    layers: [layerResult],
  };
}
