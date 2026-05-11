#!/usr/bin/env node
import path from "node:path";

import { Command } from "commander";

import { AggregateError } from "../bundle/aggregate.js";

// pnpm 10+ injects npm_config_* env vars (`verify_deps_before_run`,
// `_jsr-registry`, `npm-globalconfig`) that recent npm versions don't
// recognize. Whenever a Pi extension shells out to npm/npx for its own
// setup, every invocation prints "Unknown env config" warnings,
// flooding the run log. They are noise — drop them before any
// subprocess spawns. Other npm config (e.g. user_agent, registry) is
// left intact.
for (const key of Object.keys(process.env)) {
  if (key === "npm_config_verify_deps_before_run") delete process.env[key];
  if (key === "npm_config__jsr-registry") delete process.env[key];
  if (key === "npm_config_npm-globalconfig") delete process.env[key];
}
import { ManifestError } from "../bundle/manifest.js";
import { formatBundleName } from "../bundle/naming.js";
import { hashProfileCommand } from "./hash-profile.js";
import { EvaluatorError, OracleError } from "../evaluator/index.js";
import { runAll, runFirstRunOnly, RunnerError } from "../runner/index.js";
import { loadSpec, SpecLoadError } from "../spec/loader.js";
import { validateSpec } from "../validator/index.js";

function resolveSpecPath(packagePath: string): string {
  return path.join(path.resolve(packagePath), "spec.yaml");
}

async function runSpecShow(packagePath: string): Promise<void> {
  const spec = await loadSpec(resolveSpecPath(packagePath));
  process.stdout.write(JSON.stringify(spec, null, 2) + "\n");
}

async function runSpecValidate(
  packagePath: string,
  options: { checkBinaries: boolean },
): Promise<void> {
  const resolvedRoot = path.resolve(packagePath);
  const spec = await loadSpec(path.join(resolvedRoot, "spec.yaml"));
  const result = await validateSpec(spec, resolvedRoot, {
    checkBinaries: options.checkBinaries,
  });
  // Warnings get printed regardless of overall ok-status, prefixed with
  // `WARN`. Errors get prefixed with the implicit `[code]`. The severity
  // prefix is the only signal users have between "must-fix" and
  // "informational" once `FACET_STRICT_SCHEMA=true` flips the policy.
  for (const issue of result.issues) {
    if (issue.severity === "warning") {
      process.stdout.write(`WARN [${issue.code}] ${issue.message}\n`);
    }
  }
  if (result.ok) {
    process.stdout.write("OK\n");
    return;
  }
  const errorCount = result.issues.filter(
    (i) => (i.severity ?? "error") === "error",
  ).length;
  process.stdout.write(`FAIL (${errorCount} issue(s)):\n`);
  for (const issue of result.issues) {
    if ((issue.severity ?? "error") === "error") {
      process.stdout.write(`  [${issue.code}] ${issue.message}\n`);
    }
  }
  if (result.issues.some((i) => i.code === "binary-missing")) {
    process.stdout.write(
      "Install the missing binaries and re-run, or pass --no-binaries to skip this check.\n",
    );
  }
  process.exitCode = 1;
}

function loadDotEnvIfPresent(): void {
  const envFile = path.resolve(process.cwd(), ".env");
  try {
    process.loadEnvFile(envFile);
  } catch {
    // .env is optional — fall back to whatever is already in the environment.
  }
}

interface RunContext {
  readonly resolvedRoot: string;
  readonly specPath: string;
  readonly outputDir: string;
  // Phase 9 / Bullet 9.1 — map keyed by provider id. The CLI collects
  // distinct providers from spec.varying_factors[model_swap] and pulls
  // one env var per provider. The runner picks the right one per-run
  // based on the model level's provider.
  readonly apiKeys: Readonly<Record<string, string>>;
  readonly spec: Awaited<ReturnType<typeof loadSpec>>;
}

/**
 * Collect the distinct provider ids from a spec's model_swap factor.
 * Returns a sorted, deduplicated array. Empty when the spec has no
 * model_swap factor (caller validates separately).
 */
function collectProviders(spec: Awaited<ReturnType<typeof loadSpec>>): string[] {
  const providers = new Set<string>();
  for (const factor of spec.varying_factors) {
    if (factor.type !== "model_swap") continue;
    for (const level of factor.levels) providers.add(level.provider);
  }
  return Array.from(providers).sort();
}

/**
 * Phase 9 / Bullet 9.1. The conventional env-var name for a provider's
 * API key is `${PROVIDER}_API_KEY` with the provider id upper-cased.
 * Common examples: `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`,
 * `OPENAI_API_KEY`. The CLI is the only caller — runners receive the
 * resolved values via `RunAllParams.apiKeys`.
 */
function providerEnvVarName(provider: string): string {
  return `${provider.toUpperCase()}_API_KEY`;
}

async function prepareRunContext(packagePath: string): Promise<RunContext | undefined> {
  const resolvedRoot = path.resolve(packagePath);
  const specPath = path.join(resolvedRoot, "spec.yaml");
  const spec = await loadSpec(specPath);

  const validation = await validateSpec(spec, resolvedRoot, {
    checkBinaries: false,
  });
  if (!validation.ok) {
    process.stderr.write(
      `Spec validation failed (${validation.issues.length} issue(s)):\n`,
    );
    for (const issue of validation.issues) {
      process.stderr.write(`  [${issue.code}] ${issue.message}\n`);
    }
    process.exitCode = 1;
    return undefined;
  }

  loadDotEnvIfPresent();
  const providers = collectProviders(spec);
  const apiKeys: Record<string, string> = {};
  const missing: string[] = [];
  for (const provider of providers) {
    const envName = providerEnvVarName(provider);
    const value = process.env[envName];
    if (value === undefined || value.length === 0) {
      missing.push(envName);
    } else {
      apiKeys[provider] = value;
    }
  }
  if (missing.length > 0) {
    process.stderr.write(
      `Missing API key env var(s) for declared provider(s): ${missing.join(", ")}. Export them in your shell or set them in .env before running.\n`,
    );
    process.exitCode = 1;
    return undefined;
  }

  const bundleName = formatBundleName(spec.metadata.id);
  const outputDir = path.resolve(process.cwd(), bundleName);
  return { resolvedRoot, specPath, outputDir, apiKeys, spec };
}

async function runExperimentFirst(packagePath: string): Promise<void> {
  const ctx = await prepareRunContext(packagePath);
  if (ctx === undefined) return;

  process.stdout.write(
    `Running first run (--single) from ${ctx.resolvedRoot}\n  bundle: ${ctx.outputDir}\n`,
  );

  const { outcome, bundlePath } = await runFirstRunOnly({
    spec: ctx.spec,
    packageRoot: ctx.resolvedRoot,
    specPath: ctx.specPath,
    outputDir: ctx.outputDir,
    apiKeys: ctx.apiKeys,
  });

  process.stdout.write(`\nRun ${outcome.runId} complete\n`);
  process.stdout.write(`  prompt_id: ${outcome.promptId}\n`);
  process.stdout.write(`  scenario:  ${outcome.scenarioId}\n`);
  process.stdout.write(`  profile:   ${outcome.profileId}\n`);
  process.stdout.write(`  model:     ${outcome.modelLevelId}\n`);
  process.stdout.write(`  duration:  ${outcome.durationMs}ms\n`);
  process.stdout.write(`  events:    ${outcome.eventCount}\n`);
  process.stdout.write(
    `  tokens:    in=${outcome.tokensIn}, out=${outcome.tokensOut}, total=${outcome.tokensTotal}\n`,
  );
  process.stdout.write(`  cost:      $${outcome.costUsd.toFixed(6)}\n`);
  if (outcome.timedOut) {
    process.stdout.write(`  timed_out: true\n`);
  }
  const evalStatus = outcome.evaluation.timedOut
    ? "TIMEOUT"
    : outcome.evaluation.passed
      ? "PASS"
      : "FAIL";
  process.stdout.write(
    `  oracle:    ${evalStatus} (exit=${outcome.evaluation.exitCode}, ${outcome.evaluation.durationMs}ms)\n`,
  );
  process.stdout.write(
    `  tasks:     ${outcome.evaluation.tasksPassed}/${outcome.evaluation.tasksTotal}` +
      `  regression: ${outcome.evaluation.regressionPassed}/${outcome.evaluation.regressionTotal}\n`,
  );
  process.stdout.write(`\nBundle: ${bundlePath}\n`);
}

async function runExperimentMatrix(packagePath: string): Promise<void> {
  const ctx = await prepareRunContext(packagePath);
  if (ctx === undefined) return;

  const parallelism = Math.max(1, Math.floor(ctx.spec.design.parallelism));
  process.stdout.write(
    `Running full matrix from ${ctx.resolvedRoot}\n  bundle: ${ctx.outputDir}\n  parallelism: ${parallelism}\n`,
  );

  // Under parallelism, onRunStart/onRunEnd fire in any order. The entry-index
  // arg from the runner identifies a run's matrix position (still encoded in
  // runId). For human-readable progress, prefix each line with monotonic
  // started/completed counters so the user can see pipeline depth.
  let startedCount = 0;
  let completedCount = 0;
  const result = await runAll({
    spec: ctx.spec,
    packageRoot: ctx.resolvedRoot,
    specPath: ctx.specPath,
    outputDir: ctx.outputDir,
    apiKeys: ctx.apiKeys,
    onRunStart: (entry, _index, total) => {
      startedCount += 1;
      process.stdout.write(
        `[start ${startedCount}/${total}] ${entry.runConfig.runId}: prompt=${entry.runConfig.promptId} profile=${entry.runConfig.profileId} model=${entry.runConfig.modelLevelId} rep=${entry.runConfig.repetition}\n`,
      );
    },
    onRunEnd: (report, _index, total) => {
      completedCount += 1;
      const tokens =
        report.tokensIn !== undefined && report.tokensOut !== undefined
          ? `tokens=${report.tokensIn}/${report.tokensOut}`
          : "tokens=n/a";
      const duration = report.durationMs !== undefined ? `${report.durationMs}ms` : "n/a";
      const cost = report.costUsd !== undefined ? `$${report.costUsd.toFixed(6)}` : "n/a";
      process.stdout.write(
        `[done ${completedCount}/${total}] ${report.runConfig.runId}: ${report.status.toUpperCase()} (${duration}, ${tokens}, cost=${cost})\n`,
      );
      if (report.error !== undefined) {
        process.stdout.write(`  error: ${report.error.name}: ${report.error.message}\n`);
      }
    },
  });

  const totals = result.reports.reduce(
    (acc, r) => ({
      completed_passed: acc.completed_passed + (r.status === "completed_passed" ? 1 : 0),
      partially_completed:
        acc.partially_completed + (r.status === "partially_completed" ? 1 : 0),
      completed_failed: acc.completed_failed + (r.status === "completed_failed" ? 1 : 0),
      timeout: acc.timeout + (r.status === "timeout" ? 1 : 0),
      error: acc.error + (r.status === "error" ? 1 : 0),
      tasksPassed: acc.tasksPassed + (r.tasksPassed ?? 0),
      tokensIn: acc.tokensIn + (r.tokensIn ?? 0),
      tokensOut: acc.tokensOut + (r.tokensOut ?? 0),
      costUsd: acc.costUsd + (r.costUsd ?? 0),
    }),
    {
      completed_passed: 0,
      partially_completed: 0,
      completed_failed: 0,
      timeout: 0,
      error: 0,
      tasksPassed: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    },
  );

  const elapsedMs = result.finishedAt.getTime() - result.startedAt.getTime();
  process.stdout.write(`\nMatrix complete: ${result.reports.length} run(s) in ${elapsedMs}ms\n`);
  process.stdout.write(
    `  completed_passed=${totals.completed_passed}  partially_completed=${totals.partially_completed}  completed_failed=${totals.completed_failed}  timeout=${totals.timeout}  error=${totals.error}\n`,
  );
  process.stdout.write(`  tasks_passed_total=${totals.tasksPassed}\n`);
  process.stdout.write(
    `  tokens_in_total=${totals.tokensIn}  tokens_out_total=${totals.tokensOut}  cost_usd_total=$${totals.costUsd.toFixed(6)}\n`,
  );
  if (result.abortReason !== undefined) {
    const completed = result.reports.length - result.skippedCount;
    process.stdout.write(
      `\nABORTED: ${result.abortReason}. ${completed} of ${result.reports.length} runs completed; ${result.skippedCount} skipped.\n`,
    );
    process.exitCode = 1;
  }
  process.stdout.write(`\nBundle: ${result.bundlePath}\n`);
  process.stdout.write(`  manifest: ${result.bundlePath}/manifest.yaml\n`);
  process.stdout.write(`  aggregated: ${result.bundlePath}/aggregated/results.csv\n`);
}

function reportError(e: unknown): void {
  if (e instanceof SpecLoadError) {
    process.stderr.write(`${e.message}\n`);
  } else if (e instanceof RunnerError) {
    process.stderr.write(`Runner error: ${e.message}\n`);
  } else if (e instanceof EvaluatorError) {
    process.stderr.write(`Evaluator error: ${e.message}\n`);
  } else if (e instanceof OracleError) {
    process.stderr.write(`Oracle error: ${e.message}\n`);
  } else if (e instanceof AggregateError) {
    process.stderr.write(`Aggregate error: ${e.message}\n`);
  } else if (e instanceof ManifestError) {
    process.stderr.write(`Manifest error: ${e.message}\n`);
  } else if (e instanceof Error) {
    process.stderr.write(`${e.name}: ${e.message}\n`);
  } else {
    process.stderr.write(`Unknown error: ${String(e)}\n`);
  }
  process.exitCode = 1;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("facet")
    .description("Extensible framework for evaluating code agents.")
    .version("0.1.0");

  const spec = program.command("spec").description("Experiment spec commands");

  spec
    .command("show")
    .description("Load and print the normalized experiment spec as JSON")
    .argument("<package-path>", "Path to an experiment package directory")
    .action(async (packagePath: string) => {
      try {
        await runSpecShow(packagePath);
      } catch (e) {
        reportError(e);
      }
    });

  spec
    .command("validate")
    .description("Validate an experiment package on disk")
    .argument("<package-path>", "Path to an experiment package directory")
    .option(
      "--no-binaries",
      "Skip the host-binary preflight check (validate spec structure only)",
    )
    .action(async (packagePath: string, options: { binaries: boolean }) => {
      try {
        await runSpecValidate(packagePath, { checkBinaries: options.binaries });
      } catch (e) {
        reportError(e);
      }
    });

  program
    .command("hash-profile")
    .description(
      "Recompute the canonical sha256 of a profile package's profileRoot and write it back to package.json#facet.hash.",
    )
    .argument(
      "<package-path>",
      "Path to a profile package directory (the one with package.json#facet).",
    )
    .action(async (packagePath: string) => {
      try {
        await hashProfileCommand(packagePath);
      } catch (e) {
        reportError(e);
      }
    });

  program
    .command("run")
    .description(
      "Execute the full experiment matrix and produce a Result Bundle (spec, per-run artifacts, manifest, aggregated CSV). Use --single to run only the first cell for debugging.",
    )
    .argument("<package-path>", "Path to an experiment package directory")
    .option("--single", "Run only the first cell of the matrix (bullet 4 behavior)")
    .action(async (packagePath: string, options: { single?: boolean }) => {
      try {
        if (options.single === true) {
          await runExperimentFirst(packagePath);
        } else {
          await runExperimentMatrix(packagePath);
        }
      } catch (e) {
        reportError(e);
      }
    });

  return program;
}

await buildProgram().parseAsync(process.argv);
