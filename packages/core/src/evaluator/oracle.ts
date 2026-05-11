import { access, constants } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

// Fallback for direct callers (scripts, tests). The runner-driven path
// (`src/runner/index.ts`) always passes an explicit `oracleTimeoutMs`
// derived from `spec.environment.timeout_per_run_seconds`, so this constant
// is never observed during a real `facet run` — only by ad-hoc invocations
// of `runOracle` in scripts or unit tests that want a sane default.
export const DEFAULT_ORACLE_TIMEOUT_MS = 120_000;
export const DEFAULT_ORACLE_SCRIPT = "oracle/run.sh";

export class OracleError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OracleError";
  }
}

export interface OracleResult {
  readonly passed: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly scriptRelPath: string;
}

export interface RunOracleOptions {
  readonly timeoutMs?: number;
  // Phase 8 / Bullet 8.2 — F-37. Relative path of the oracle script
  // inside the scenario directory. Defaults to `oracle/run.sh`. The
  // runner threads the spec's `metrics.evaluator.layers[].script` here.
  readonly scriptRelPath?: string;
}

export async function runOracle(
  scenarioPath: string,
  workspacePath: string,
  options: RunOracleOptions = {},
): Promise<OracleResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_ORACLE_TIMEOUT_MS;
  const scriptRelPath = options.scriptRelPath ?? DEFAULT_ORACLE_SCRIPT;
  const scriptPath = path.join(scenarioPath, scriptRelPath);

  try {
    await access(scriptPath, constants.X_OK);
  } catch (error) {
    throw new OracleError(
      `Oracle script not found or not executable: ${scriptPath}`,
      { cause: error },
    );
  }

  const subprocess = execa(scriptPath, [workspacePath], {
    reject: false,
    timeout: timeoutMs,
    all: false,
    stdin: "ignore",
    stripFinalNewline: false,
    detached: true,
    forceKillAfterDelay: 500,
  });

  // execa's timeout only signals the direct child. The oracle script is a shell
  // that spawns grandchildren (npm, node, vitest), which inherit the stdio pipes
  // and keep the subprocess promise pending after the shell dies. By spawning
  // detached we create a process group, then on timeout we SIGKILL the whole
  // group so every descendant is torn down.
  let groupKillTimer: NodeJS.Timeout | undefined;
  const pid = subprocess.pid;
  if (timeoutMs > 0 && pid !== undefined) {
    groupKillTimer = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Group already gone — nothing to do.
      }
    }, timeoutMs + 250);
    groupKillTimer.unref();
  }

  let result;
  try {
    result = await subprocess;
  } finally {
    if (groupKillTimer !== undefined) {
      clearTimeout(groupKillTimer);
    }
  }

  const exitCode = typeof result.exitCode === "number" ? result.exitCode : -1;
  const passed = !result.timedOut && exitCode === 0 && !result.failed;

  return {
    passed,
    exitCode,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    durationMs: result.durationMs,
    timedOut: Boolean(result.timedOut),
    scriptRelPath,
  };
}
