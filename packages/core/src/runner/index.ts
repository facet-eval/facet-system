import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { writeAggregatedCSV, writeAggregatedJSONL } from "../bundle/aggregate.js";
import {
  writeManifest,
  type ManifestDocument,
  type MatrixRunReport,
  type MatrixRunResults,
  type RunStatus,
} from "../bundle/manifest.js";
import { formatRunId } from "../bundle/naming.js";
import { BundleWriter, type RunConfig } from "../bundle/writer.js";
import {
  evaluateRun,
  type EvaluationResult,
  type OracleTaskResult,
} from "../evaluator/index.js";
import {
  deriveLayer2Metrics,
  flattenLayer2,
  type Layer2Metrics,
} from "../evaluator/layer2.js";
// Bullet 16.3 — no static `@facet/harness-pi` import. Production
// callers (runAll / runFirstRunOnly) dynamically load the harness
// declared in `spec.metadata.harness.package` via
// `loadHarness(packageName, packageRoot)` and thread the
// `LoadedHarness` into the runner. The runner only ever sees the
// `HarnessAdapter` contract from the SDK.
import type { HarnessAdapter } from "@facet/sdk/harness";

import { gitWorktreeWorkspaceStrategy } from "../builtins/workspace-strategies/git-worktree.js";
import {
  loadHarness,
  type LoadedHarness,
} from "../harness-loader.js";
import { loadPlugins } from "../plugin-loader.js";
import { loadProfilePackage } from "../profile-package/loader.js";
import { createEvaluatorLayerRegistry } from "../registries/evaluator-layer-registry.js";
import {
  createExtensionsContributionRegistry,
  type ExtensionsContributionRegistry,
} from "../registries/extensions-contribution-registry.js";
import { createFactorKindRegistry } from "../registries/factor-kind-registry.js";
import { createMetricKindRegistry } from "../registries/metric-kind-registry.js";
import { createOutputEmitterRegistry } from "../registries/output-emitter-registry.js";
import { createTraceEventRegistry } from "../registries/trace-event-registry.js";
import { createWorkspaceStrategyRegistry } from "../registries/workspace-strategy-registry.js";
import { ScenarioMetaSchema, type ExperimentSpec, type ModelLevel } from "../spec/schema.js";
import { Tracer } from "../tracer/index.js";
import type { TraceEvent as TracerTraceEvent } from "../tracer/schema.js";
// `destroyWorkspace` / `prepareScenarioRepo` / `prepareWorkspace` are
// no longer called directly from the runner — the workspace-strategy
// registry handler (Bullet 16.1) owns both prep and cleanup. The
// helpers stay exported from `../workspace/` because builtin strategies
// and tests still consume them.
import {
  loadExtensionsManifest,
  resolveExtensionPathsForScenario,
  type ExtensionsManifest,
} from "./extensions.js";
import {
  assertNoTokenOverflow,
  BudgetExceededError,
  BudgetTracker,
  TokenOverflowError,
} from "./budget.js";
import { prepareAgentPin } from "./agent-pin.js";
import {
  buildModelParamCombinations,
  collectFactorAxes,
} from "./factors/index.js";
import { runWithLimit } from "./pool.js";
import {
  loadToolEntries,
  resolveToolsForScenario,
  type ToolGate,
} from "./tools.js";
import { prepareUpfrontContext } from "./upfront-context.js";

import {
  getInstalledFrameworkVersion,
  gitProvenance,
  mixSeed,
} from "./version.js";

export class RunnerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RunnerError";
  }
}

export { BudgetExceededError, BudgetTracker, TokenOverflowError } from "./budget.js";

export interface ProfileDefinition {
  readonly id: string;
  readonly ref: string;
  // Absolute path to the resolved profile directory. Phase 5's
  // pre-session hooks (`prepareUpfrontContext`, `prepareAgentPin`)
  // resolve `pinned_agents.source_dir` and `upfront_context.cwd` relative
  // to this so profile-supplied scripts and agent .md files travel with
  // the experiment package.
  readonly profilePath: string;
  // Phase 11 / Bullet 11.4 — structured tool allowlist. Use
  // `resolveToolsForScenario(toolEntries, scenarioId)` to flatten to
  // the string array Pi expects.
  readonly toolEntries: readonly ToolGate[];
  readonly systemPrompt: string;
  readonly extensions: ExtensionsManifest | undefined;
  // Bullet 14.2 — when the spec's profile ref resolves through
  // `loadProfilePackage` (npm-style ref), the package metadata is
  // surfaced here so the manifest writer can include it in
  // `provenance.profiles[]`. Undefined for relative bare-path refs
  // that pre-date Phase 14.
  readonly packageName: string | undefined;
  readonly packageVersion: string | undefined;
  readonly declaredHash: string | undefined;
}

export { type ToolGate, resolveToolsForScenario } from "./tools.js";

export interface ScenarioDefinition {
  readonly id: string;
  readonly scenarioPath: string;
  readonly promptPathsById: ReadonlyMap<string, string>;
  // Phase 8 / Bullet 8.1 — declared task ids the oracle must emit.
  // `undefined` means the scenario relies on the framework default
  // (`DEFAULT_TASK_IDS`).
  readonly taskIds: readonly string[] | undefined;
  // Phase 8 / Bullet 8.3 — subdirectory of `scenarioPath` that becomes
  // the per-run git repo. `undefined` ⇒ framework default ("repo").
  readonly codeDir: string | undefined;
  // Phase 10 / Bullet 10.2 — basenames to exclude from the per-run
  // workspace copy in addition to the framework default denylist.
  readonly bundleExcludes: readonly string[] | undefined;
}

export interface RunOutcome {
  readonly runId: string;
  readonly promptId: string;
  readonly scenarioId: string;
  readonly profileId: string;
  readonly modelLevelId: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly eventCount: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensTotal: number;
  readonly costUsd: number;
  readonly clarificationRequestsCount: number;
  readonly finalMessage: string | undefined;
  readonly evaluation: EvaluationResult;
  readonly layer2: Layer2Metrics;
}

// A ref is treated as an npm package iff it starts with `@` (scoped) or
// is a bare unscoped name (no `/`, no `.`). Mirrors the classification
// in `profile-package/loader.ts` and `validator/index.ts`.
function isNpmRef(ref: string): boolean {
  if (ref.startsWith("@")) return true;
  if (
    ref.startsWith("./") ||
    ref.startsWith("../") ||
    ref.startsWith("/") ||
    ref.startsWith("~/")
  ) {
    return false;
  }
  return !ref.includes("/");
}

export async function loadProfileDefinition(
  packageRoot: string,
  profileRef: string,
  profileId: string,
  // Bullet 16.2 — when supplied, the contributions registry is used to
  // compose the root extensions.yaml schema dynamically (e.g. the Pi
  // harness contributes `pinned_agents` and `language_servers`). Test
  // seams pass `undefined` and only the universal keys are accepted.
  contributionsRegistry?: ExtensionsContributionRegistry,
): Promise<ProfileDefinition> {
  let profilePath: string;
  let packageName: string | undefined;
  let packageVersion: string | undefined;
  let declaredHash: string | undefined;
  if (isNpmRef(profileRef)) {
    const preset = await loadProfilePackage(profileRef, packageRoot);
    profilePath = preset.profilePath;
    packageName = preset.packageName;
    packageVersion = preset.packageVersion;
    declaredHash = preset.manifest.hash;
  } else {
    profilePath = path.resolve(packageRoot, profileRef);
  }
  const toolEntries: readonly ToolGate[] = await loadToolEntries(
    profilePath,
    profileId,
  );
  let systemPrompt: string;
  try {
    systemPrompt = await readFile(path.join(profilePath, "SYSTEM.md"), "utf8");
  } catch (error) {
    throw new RunnerError(
      `Failed to read SYSTEM.md in profile "${profileId}": ${(error as Error).message}`,
      { cause: error },
    );
  }
  const extensions = await loadExtensionsManifest(
    profilePath,
    profileId,
    packageRoot,
    undefined,
    contributionsRegistry,
  );
  return {
    id: profileId,
    ref: profileRef,
    profilePath,
    toolEntries,
    systemPrompt,
    extensions,
    packageName,
    packageVersion,
    declaredHash,
  };
}

export async function loadScenarioDefinition(
  packageRoot: string,
  scenarioRef: string,
  scenarioId: string,
): Promise<ScenarioDefinition> {
  const scenarioPath = path.resolve(packageRoot, scenarioRef);
  const metaPath = path.join(scenarioPath, "meta.yaml");
  let metaRaw: string;
  try {
    metaRaw = await readFile(metaPath, "utf8");
  } catch (error) {
    throw new RunnerError(
      `Failed to read meta.yaml for scenario "${scenarioId}": ${(error as Error).message}`,
      { cause: error },
    );
  }
  const parsed = ScenarioMetaSchema.safeParse(parseYaml(metaRaw));
  if (!parsed.success) {
    throw new RunnerError(
      `Invalid meta.yaml for scenario "${scenarioId}": ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }
  const promptPathsById = new Map<string, string>();
  for (const prompt of parsed.data.prompts) {
    promptPathsById.set(prompt.id, path.join(scenarioPath, prompt.file));
  }
  return {
    id: scenarioId,
    scenarioPath,
    promptPathsById,
    taskIds: parsed.data.task_ids,
    codeDir: parsed.data.code_dir,
    bundleExcludes: parsed.data.bundle_excludes,
  };
}

export interface MatrixEntry {
  readonly runConfig: RunConfig;
  readonly modelLevel: ModelLevel;
  readonly profileRef: string;
  readonly scenarioRef: string;
}

export function expandMatrix(spec: ExperimentSpec): MatrixEntry[] {
  const axes = collectFactorAxes(spec.varying_factors);
  if (axes.prompts.length === 0 || axes.profiles.length === 0 || axes.models.length === 0) {
    throw new RunnerError(
      "Spec varying_factors must declare at least one factor of each kind: prompt_swap, extension_select, model_swap",
    );
  }
  if (spec.scenarios.length === 0) {
    throw new RunnerError("Spec has no scenarios");
  }
  const paramCombos = buildModelParamCombinations(axes.modelParams);

  const entries: MatrixEntry[] = [];
  let index = 1;
  for (const scenario of spec.scenarios) {
    for (const prompt of axes.prompts) {
      for (const profile of axes.profiles) {
        for (const model of axes.models) {
          for (const params of paramCombos) {
            for (let rep = 1; rep <= spec.design.repetitions; rep += 1) {
              const runId = formatRunId(index);
              const runConfig: RunConfig = {
                runId,
                promptId: prompt.id,
                profileId: profile.id,
                modelLevelId: model.id,
                provider: model.provider,
                modelId: model.model_id,
                scenarioId: scenario.id,
                repetition: rep,
                ...(Object.keys(params).length > 0 ? { harnessParams: params } : {}),
                seed: spec.metadata.seed,
                derivedSeed: mixSeed(spec.metadata.seed, runId),
              };
              entries.push({
                runConfig,
                modelLevel: model,
                profileRef: profile.ref,
                scenarioRef: scenario.ref,
              });
              index += 1;
            }
          }
        }
      }
    }
  }
  return entries;
}

interface RunSummaryDocument {
  readonly run_id: string;
  readonly status: RunStatus;
  readonly duration_ms?: number;
  readonly event_count?: number;
  readonly tokens_in?: number;
  readonly tokens_out?: number;
  readonly tokens_total?: number;
  readonly cost_usd?: number;
  readonly timed_out?: boolean;
  readonly oracle_timed_out?: boolean;
  readonly final_message?: string | undefined;
  readonly clarification_requests_count?: number;
  // Phase 10 / Bullet 10.8 — B-04. Canonical naming. `tasks_completed`
  // is gone; aggregator still reads pre-Phase-10 bundles via the old
  // key for back-compat.
  readonly tasks_passed?: number;
  readonly tasks_total?: number;
  readonly regression_tests_passed?: number;
  readonly regression_tests_total?: number;
  // Phase 10 / Bullet 10.8 — B-05. Per-run wall-clock timestamps. With
  // parallelism>1, the manifest's spec-level started_at/finished_at no
  // longer tell a reader when each individual run started. ISO-8601 UTC.
  readonly started_at?: string;
  readonly finished_at?: string;
  // Phase 9 / Bullet 9.3 — F-32. Per-run warnings surfaced from the
  // harness adapter or evaluator. Today the only emitter is the
  // "context-window-unknown" notice fired when the model's resolved
  // contextWindow is 0 (Pi's optional-field default). Documented as
  // an array of stable string codes so future warnings can append
  // without breaking readers.
  readonly warnings?: readonly string[];
  readonly error?: { readonly name: string; readonly message: string };
}

/**
 * Phase 10 / Bullet 10.5 — F-52. Atomic finalization. `summary.json` is
 * always written *last* per run; readers (aggregator) consider a run
 * "complete" iff this file exists and parses. We use a tmp + rename so
 * a crashed run never leaves a half-written summary that the aggregator
 * would happily parse as zero-valued. The writer guarantees an
 * atomic POSIX `rename(2)` on the same filesystem (the bundle dir).
 */
async function writeRunSummary(
  bundleWriter: BundleWriter,
  runId: string,
  summary: RunSummaryDocument,
): Promise<void> {
  await bundleWriter.writeRunArtifactAtomic(
    runId,
    "summary.json",
    JSON.stringify(summary, null, 2) + "\n",
  );
}

interface TestsJsonDocument {
  readonly version: "v2";
  readonly run_id: string;
  readonly passed: boolean;
  readonly exit_code: number;
  readonly duration_ms: number;
  readonly timed_out: boolean;
  readonly tasks_total: number;
  readonly tasks_passed: number;
  readonly regression_tests_total: number;
  readonly regression_tests_passed: number;
  readonly per_task: readonly OracleTaskResult[];
  readonly regression: readonly OracleTaskResult[];
  readonly layers: EvaluationResult["layers"];
}

export function buildTestsJson(evaluation: EvaluationResult): TestsJsonDocument {
  return {
    version: "v2",
    run_id: evaluation.runId,
    passed: evaluation.passed,
    exit_code: evaluation.exitCode,
    duration_ms: evaluation.durationMs,
    timed_out: evaluation.timedOut,
    tasks_total: evaluation.tasksTotal,
    tasks_passed: evaluation.tasksPassed,
    regression_tests_total: evaluation.regressionTotal,
    regression_tests_passed: evaluation.regressionPassed,
    per_task: evaluation.perTask,
    regression: evaluation.regression,
    layers: evaluation.layers,
  };
}

export function deriveStatus(opts: {
  readonly sessionTimedOut: boolean;
  readonly oracleTimedOut: boolean;
  readonly tasksPassed: number;
  readonly tasksTotal: number;
  readonly hardError: boolean;
}): RunStatus {
  if (opts.hardError) return "error";
  if (opts.sessionTimedOut || opts.oracleTimedOut) return "timeout";
  if (opts.tasksPassed === opts.tasksTotal) return "completed_passed";
  if (opts.tasksPassed === 0) return "completed_failed";
  return "partially_completed";
}

export interface RunSingleRunParams {
  readonly spec: ExperimentSpec;
  readonly runConfig: RunConfig;
  readonly modelLevel: ModelLevel;
  readonly scenarioDef: ScenarioDefinition;
  readonly profileDef: ProfileDefinition;
  readonly bundleWriter: BundleWriter;
  readonly timeoutMs: number;
  readonly oracleTimeoutMs?: number;
  // Bullet 15.2 — root of the experiment package. Used to resolve
  // relative refs in `spec.metadata.plugins[]`. Optional for
  // back-compat with test seams that construct `runSingleRun` calls
  // directly; the plugin loader is a no-op when both `packageRoot`
  // and `spec.metadata.plugins` are undefined.
  readonly packageRoot?: string;
  // Phase 9 / Bullet 9.1 — provider-keyed API key lookup. The CLI
  // collects distinct providers from spec.varying_factors[model_swap]
  // up-front and populates this map from `${PROVIDER}_API_KEY` env vars.
  // Undefined here ⇒ the runner skips the auth-storage handoff (test
  // seam: stub harnesses don't need real keys).
  readonly apiKeys?: Readonly<Record<string, string>>;
  // Bullet 16.3 — the loaded harness. Production callers populate
  // this from `loadHarness(spec.metadata.harness.package, packageRoot)`.
  // Tests pass an in-process fake (built with `defineHarness`) and an
  // optional `harnessRegister` for tests that want to assert the
  // register hook runs. The runner throws clearly when neither is
  // provided — there is no static fallback to a specific harness.
  readonly harness?: HarnessAdapter;
  // Optional register-hook from the loaded harness. Called with the
  // composed registry set at the same point the per-run plugin loader
  // runs, so harness-shipped metric kinds + extensions contributions
  // land in the registries. Tests that don't care about registration
  // omit this.
  readonly harnessRegister?: (registries: unknown) => void | Promise<void>;
}

export async function runSingleRun(params: RunSingleRunParams): Promise<RunOutcome> {
  const {
    spec,
    runConfig,
    modelLevel,
    scenarioDef,
    profileDef,
    bundleWriter,
    timeoutMs,
    oracleTimeoutMs,
    apiKeys,
    harness,
  } = params;
  if (harness === undefined) {
    throw new RunnerError(
      "runSingleRun requires `harness` (the loaded HarnessAdapter). Production callers (runAll/runFirstRunOnly) populate this from loadHarness(spec.metadata.harness.package, packageRoot); tests pass an in-process fake built with defineHarness.",
    );
  }
  const activeHarness: HarnessAdapter = harness;
  const apiKey = apiKeys?.[modelLevel.provider];

  await bundleWriter.initRun(runConfig);
  const runDir = bundleWriter.runDir(runConfig.runId);
  // Phase 10 / Bullet 10.8 — B-05. Capture run wall-clock at the entry
  // point. With parallelism>1, the manifest's spec-level timestamps
  // collapse all runs together; per-run timestamps let a downstream
  // reader reconstruct who ran when.
  const startedAtIso = new Date().toISOString();

  const promptPath = scenarioDef.promptPathsById.get(runConfig.promptId);
  if (promptPath === undefined) {
    throw new RunnerError(
      `Scenario "${scenarioDef.id}" does not declare prompt_id "${runConfig.promptId}"`,
    );
  }
  const prompt = await readFile(promptPath, "utf8");

  // Bullet 16.1 — workspace dispatch via the registry. The built-in
  // `git_worktree` strategy is registered eagerly; plugins declared in
  // `metadata.plugins[]` (loaded later in this function) can add more.
  // Today the registry is rebuilt per run alongside the metric-kind
  // registry; Phase 17 will lift both to a process-wide composition.
  const workspaceStrategyRegistry = createWorkspaceStrategyRegistry();
  workspaceStrategyRegistry.register(gitWorktreeWorkspaceStrategy);
  const wsHandler = workspaceStrategyRegistry.get(
    spec.environment.workspace_strategy,
  );
  if (wsHandler === undefined) {
    throw new RunnerError(
      `Unknown workspace_strategy "${spec.environment.workspace_strategy}". Registered: ${workspaceStrategyRegistry
        .ids()
        .join(", ")}. Add the handler via a plugin in metadata.plugins[] or a harness's register() hook.`,
    );
  }
  // The git_worktree handler internally calls prepareScenarioRepo +
  // createGitWorktree; future strategies (in_memory, docker) own their
  // own setup. The handle's cleanup runs from the finally block at the
  // bottom of this function.
  const wsHandle = await wsHandler.prepare(
    {
      scenarioPath: scenarioDef.scenarioPath,
      scenarioId: runConfig.scenarioId,
      codeDir: scenarioDef.codeDir ?? "repo",
      runId: runConfig.runId,
      bundlePath: bundleWriter.bundlePath,
    },
    undefined,
  );
  const workspacePath = wsHandle.path;

  const additionalExtensionPaths = resolveExtensionPathsForScenario(
    profileDef.extensions,
    runConfig.scenarioId,
  );

  const upfrontContext = await prepareUpfrontContext({
    extensions: profileDef.extensions,
    profilePath: profileDef.profilePath,
    scenarioId: runConfig.scenarioId,
    workspacePath,
  });
  const agentPin = await prepareAgentPin({
    extensions: profileDef.extensions,
    profilePath: profileDef.profilePath,
    provider: modelLevel.provider,
    modelId: modelLevel.model_id,
    runDir,
  });

  const tracePath = path.join(runDir, "trace.jsonl");
  const tracer = new Tracer({
    outputPath: tracePath,
    harness: activeHarness.id,
    harnessVersion: activeHarness.version,
  });
  try {
    // Bullet 12.2: HarnessRunConfig is harness-agnostic. Pi-specific knobs
    // (agentDir, additionalExtensionPaths, appendSystemPrompts) ride in
    // `extras`; the Pi adapter narrows them at the boundary. A non-Pi
    // harness reads whatever extras keys it understands and ignores the
    // rest.
    const extras: Record<string, unknown> = {
      additionalExtensionPaths,
    };
    if (upfrontContext !== undefined) {
      extras["appendSystemPrompts"] = [upfrontContext];
    }
    if (agentPin !== undefined) {
      extras["agentDir"] = agentPin.agentDir;
    }
    const result = await activeHarness.runSession(
      {
        tools: resolveToolsForScenario(profileDef.toolEntries, runConfig.scenarioId),
        systemPrompt: profileDef.systemPrompt,
        provider: modelLevel.provider,
        modelId: modelLevel.model_id,
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(runConfig.harnessParams !== undefined
          ? { harnessParams: runConfig.harnessParams }
          : {}),
        extras,
      },
      prompt,
      workspacePath,
      // Bullet 12.2: SDK-shaped event handed back as the open `TraceEventBase`.
      // Phase 12.5 unifies tracer's closed union with a registry-built shape
      // and removes the cast; today every Pi-produced event satisfies the
      // closed union by construction (the Pi adapter only emits the 6 builtin
      // kinds via `translateEvent`).
      (event) => tracer.record(event as TracerTraceEvent),
    );
    // Close the trace before re-reading it for layer 2 derivation. Tracer
    // close is idempotent, so the safety-net close in `finally` stays.
    tracer.close();

    // Token cap enforcement (F-30 / G-05). Throws TokenOverflowError, which
    // the existing catch in runMatrixEntry surfaces as a per-run summary
    // with status="error" / error.name="TokenOverflowError". Workspace and
    // tracer cleanup runs in the surrounding `finally`, so the per-run
    // artifacts that already landed (trace.jsonl) are preserved for
    // forensics; the workspace copy and oracle are skipped intentionally
    // so a clearly-broken run does not consume more disk or oracle time.
    assertNoTokenOverflow(
      result.tokenUsage.total,
      spec.environment.max_tokens_per_run,
      runConfig.runId,
    );

    await bundleWriter.copyWorkspaceIntoRun(
      runConfig.runId,
      workspacePath,
      scenarioDef.bundleExcludes,
    );

    const evaluation = await evaluateRun({
      spec,
      runConfig,
      scenarioPath: scenarioDef.scenarioPath,
      workspacePath,
      timeoutMs: oracleTimeoutMs,
      ...(scenarioDef.taskIds !== undefined
        ? { expectedTaskIds: scenarioDef.taskIds }
        : {}),
    });
    await bundleWriter.writeRunArtifact(
      runConfig.runId,
      "tests.json",
      JSON.stringify(buildTestsJson(evaluation), null, 2) + "\n",
    );

    // Bullet 13.3 + 15.2 + 16.1: populate the seven user-registrable
    // registries from the active harness adapter and any plugins the
    // spec declares in `metadata.plugins`. The workspace-strategy
    // registry was instantiated earlier in this function (it needs to
    // exist before the workspace is prepared); the others come into
    // play here so plugin-declared metric kinds, factor kinds, trace
    // event kinds, evaluator layers, output emitters, and extensions
    // contributions all reach the dispatcher in the same pass.
    const metricKindRegistry = createMetricKindRegistry();
    const factorKindRegistry = createFactorKindRegistry();
    const traceEventRegistry = createTraceEventRegistry();
    const evaluatorLayerRegistry = createEvaluatorLayerRegistry();
    const outputEmitterRegistry = createOutputEmitterRegistry();
    const extensionsContributionRegistry = createExtensionsContributionRegistry();
    const harnessRegisterFn = params.harnessRegister;
    const registriesForPlugins = {
      metricKind: metricKindRegistry,
      factorKind: factorKindRegistry,
      traceEvent: traceEventRegistry,
      evaluatorLayer: evaluatorLayerRegistry,
      outputEmitter: outputEmitterRegistry,
      workspaceStrategy: workspaceStrategyRegistry,
      extensionsContribution: extensionsContributionRegistry,
    } as const;
    // Bullet 16.3 — the loaded harness's register hook (if any) runs
    // here, replacing the old static `registerPiHarness({ metricKind
    // })` call. The hook signature is the same shape the SDK guides
    // document — `register(registries)` — so swapping in a different
    // harness package is a spec-side change.
    if (harnessRegisterFn !== undefined) {
      await harnessRegisterFn(registriesForPlugins);
    }
    if (
      params.spec.metadata.plugins !== undefined &&
      params.packageRoot !== undefined
    ) {
      await loadPlugins(
        params.spec.metadata.plugins,
        params.packageRoot,
        registriesForPlugins,
      );
    }
    const layer2 = await deriveLayer2Metrics({
      tracePath,
      profileId: runConfig.profileId,
      contextWindow: result.contextWindow,
      clarificationRequestsCount: result.clarificationRequestsCount,
      metricRules: profileDef.extensions?.metricRules ?? [],
      metricKindRegistry,
    });
    // Flatten profile_metrics to top-level keys so downstream readers
    // (manifest writer, aggregated CSV builder, downstream Python) see a
    // uniform record — same on-disk shape as pre-Phase-4 for any single
    // profile, only the framework no longer enumerates the names.
    await bundleWriter.writeRunArtifact(
      runConfig.runId,
      "metrics.json",
      JSON.stringify(flattenLayer2(layer2), null, 2) + "\n",
    );

    const status: RunStatus = deriveStatus({
      sessionTimedOut: result.timedOut,
      oracleTimedOut: evaluation.timedOut,
      tasksPassed: evaluation.tasksPassed,
      tasksTotal: evaluation.tasksTotal,
      hardError: false,
    });
    // Phase 9 / Bullet 9.3 — F-32. Surface a stable warning code when
    // the harness could not resolve the model's context window. Pi's
    // model overrides treat `contextWindow` as optional and we then see
    // `0` in `result.contextWindow`. Layer-2 already returns 0 for the
    // utilization percentages in that case; this warning makes the
    // ambiguity visible in summary.json so a downstream reader doesn't
    // misinterpret 0% utilization as "model used no context".
    const warnings: string[] = [];
    if (result.contextWindow === 0) {
      warnings.push("context-window-unknown");
      console.warn(
        `WARN [context-window-unknown] Pi did not resolve a context_window for model "${modelLevel.model_id}" (provider="${modelLevel.provider}"); context-utilization metrics will be 0 for this run`,
      );
    }
    await writeRunSummary(bundleWriter, runConfig.runId, {
      run_id: runConfig.runId,
      status,
      duration_ms: result.durationMs,
      event_count: result.events.length,
      tokens_in: result.tokenUsage.input,
      tokens_out: result.tokenUsage.output,
      tokens_total: result.tokenUsage.total,
      cost_usd: result.costUsd,
      timed_out: result.timedOut,
      oracle_timed_out: evaluation.timedOut,
      final_message: result.finalMessage,
      clarification_requests_count: result.clarificationRequestsCount,
      tasks_passed: evaluation.tasksPassed,
      tasks_total: evaluation.tasksTotal,
      regression_tests_passed: evaluation.regressionPassed,
      regression_tests_total: evaluation.regressionTotal,
      started_at: startedAtIso,
      finished_at: new Date().toISOString(),
      ...(warnings.length > 0 ? { warnings } : {}),
    });

    await bundleWriter.finalizeRun(runConfig.runId);

    return {
      runId: runConfig.runId,
      promptId: runConfig.promptId,
      scenarioId: runConfig.scenarioId,
      profileId: runConfig.profileId,
      modelLevelId: runConfig.modelLevelId,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      eventCount: result.events.length,
      tokensIn: result.tokenUsage.input,
      tokensOut: result.tokenUsage.output,
      tokensTotal: result.tokenUsage.total,
      costUsd: result.costUsd,
      clarificationRequestsCount: result.clarificationRequestsCount,
      finalMessage: result.finalMessage,
      evaluation,
      layer2,
    };
  } finally {
    tracer.close();
    if (agentPin !== undefined) await agentPin.cleanup();
    await wsHandle.cleanup();
  }
}

export interface FirstRunResolution {
  readonly promptId: string;
  readonly profileId: string;
  readonly profileRef: string;
  readonly modelLevel: ModelLevel;
  readonly scenarioId: string;
  readonly scenarioRef: string;
}

export function resolveFirstRun(spec: ExperimentSpec): FirstRunResolution {
  const entries = expandMatrix(spec);
  const first = entries[0];
  if (first === undefined) {
    throw new RunnerError("Experiment matrix is empty");
  }
  return {
    promptId: first.runConfig.promptId,
    profileId: first.runConfig.profileId,
    profileRef: first.profileRef,
    modelLevel: first.modelLevel,
    scenarioId: first.runConfig.scenarioId,
    scenarioRef: first.scenarioRef,
  };
}

export async function runFirstRunOnly(params: {
  readonly spec: ExperimentSpec;
  readonly packageRoot: string;
  readonly specPath: string;
  readonly outputDir: string;
  // Phase 9 / Bullet 9.1 — provider-keyed API key lookup. The CLI
  // collects distinct providers from spec.varying_factors[model_swap]
  // up-front and populates this map from `${PROVIDER}_API_KEY` env vars.
  // Undefined here ⇒ the runner skips the auth-storage handoff (test
  // seam: stub harnesses don't need real keys).
  readonly apiKeys?: Readonly<Record<string, string>>;
}): Promise<{ outcome: RunOutcome; bundlePath: string }> {
  const first = resolveFirstRun(params.spec);
  // Bullet 16.3 — dynamically load the harness declared in
  // `spec.metadata.harness.package`. The runner no longer knows
  // about `@facet/harness-pi` at compile time. The contributions
  // registry is populated by the harness's `register()` hook so
  // every profile's `extensions.yaml` parses against the
  // harness-aware schema.
  const loaded = await loadHarness(
    params.spec.metadata.harness.package,
    params.packageRoot,
  );
  const contributionsRegistry = createExtensionsContributionRegistry();
  if (loaded.register !== undefined) {
    await loaded.register({
      metricKind: createMetricKindRegistry(),
      extensionsContribution: contributionsRegistry,
    });
  }
  const profileDef = await loadProfileDefinition(
    params.packageRoot,
    first.profileRef,
    first.profileId,
    contributionsRegistry,
  );
  const scenarioDef = await loadScenarioDefinition(
    params.packageRoot,
    first.scenarioRef,
    first.scenarioId,
  );

  const bundleWriter = new BundleWriter(params.outputDir);
  await bundleWriter.initBundle(params.specPath, params.spec);

  const runId = formatRunId(1);
  const runConfig: RunConfig = {
    runId,
    promptId: first.promptId,
    profileId: first.profileId,
    modelLevelId: first.modelLevel.id,
    provider: first.modelLevel.provider,
    modelId: first.modelLevel.model_id,
    scenarioId: first.scenarioId,
    repetition: 1,
    seed: params.spec.metadata.seed,
    derivedSeed: mixSeed(params.spec.metadata.seed, runId),
  };

  const perRunTimeoutMs = params.spec.environment.timeout_per_run_seconds * 1000;
  const outcome = await runSingleRun({
    spec: params.spec,
    runConfig,
    modelLevel: first.modelLevel,
    scenarioDef,
    profileDef,
    bundleWriter,
    timeoutMs: perRunTimeoutMs,
    // The oracle inherits the per-run wall-clock budget. One spec field
    // (`environment.timeout_per_run_seconds`) is the single source of truth
    // for the runner-driven path; the module-level fallback in
    // `src/evaluator/oracle.ts` only applies to direct callers (scripts, tests).
    oracleTimeoutMs: perRunTimeoutMs,
    packageRoot: params.packageRoot,
    harness: loaded.adapter,
    ...(loaded.register !== undefined ? { harnessRegister: loaded.register } : {}),
    ...(params.apiKeys !== undefined ? { apiKeys: params.apiKeys } : {}),
  });
  // Emit aggregated outputs even for --single so downstream tooling
  // can rely on the files existing whenever a Result Bundle is produced.
  await emitAggregatedOutputs(bundleWriter.bundlePath, params.spec);

  return { outcome, bundlePath: bundleWriter.bundlePath };
}

/**
 * Phase 10 / Bullet 10.1 — F-45. Honor `spec.analysis.emit`. The CSV is
 * always written (every emit tag is a superset of "produce the table");
 * the JSONL is additive when `results_table_jsonl` is declared.
 */
async function emitAggregatedOutputs(
  bundlePath: string,
  spec: ExperimentSpec,
): Promise<void> {
  const tags = new Set(spec.analysis.emit);
  if (tags.has("results_table_csv")) {
    await writeAggregatedCSV(bundlePath);
  }
  if (tags.has("results_table_jsonl")) {
    await writeAggregatedJSONL(bundlePath);
  }
}

export interface RunAllParams {
  readonly spec: ExperimentSpec;
  readonly packageRoot: string;
  readonly specPath: string;
  readonly outputDir: string;
  // Phase 9 / Bullet 9.1 — provider-keyed API key lookup. The CLI
  // collects distinct providers from spec.varying_factors[model_swap]
  // up-front and populates this map from `${PROVIDER}_API_KEY` env vars.
  // Undefined here ⇒ the runner skips the auth-storage handoff (test
  // seam: stub harnesses don't need real keys).
  readonly apiKeys?: Readonly<Record<string, string>>;
  readonly onRunStart?: (entry: MatrixEntry, index: number, total: number) => void;
  readonly onRunEnd?: (report: MatrixRunReport, index: number, total: number) => void;
  // Test seam — production callers leave undefined and the real `runSingleRun`
  // is used. Tests inject a fake to drive cost/abort paths deterministically.
  readonly runSingleRunFn?: typeof runSingleRun;
}

export interface RunAllResult {
  readonly bundlePath: string;
  readonly reports: readonly MatrixRunReport[];
  readonly manifest: ManifestDocument;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  // When the cumulative cost cap fires, this carries the human-readable
  // reason ("max_total_cost_usd reached: $X of $Y USD"). Undefined on a
  // matrix that completed within budget. The CLI turns a defined value
  // into an `ABORTED:` line and exit code 1.
  readonly abortReason: string | undefined;
  readonly skippedCount: number;
}

export async function runAll(params: RunAllParams): Promise<RunAllResult> {
  const entries = expandMatrix(params.spec);
  const bundleWriter = new BundleWriter(params.outputDir);
  await bundleWriter.initBundle(params.specPath, params.spec);

  // Bullet 16.3 — load the declared harness once, then let its
  // register() hook populate the contributions registry (Pi
  // contributes `pinned_agents`, `language_servers`).
  const loaded = await loadHarness(
    params.spec.metadata.harness.package,
    params.packageRoot,
  );
  const contributionsRegistry = createExtensionsContributionRegistry();
  if (loaded.register !== undefined) {
    await loaded.register({
      metricKind: createMetricKindRegistry(),
      extensionsContribution: contributionsRegistry,
    });
  }

  // Promise-valued caches so concurrent workers asking for the same agent
  // setup or scenario coalesce on the in-flight load instead of racing to
  // populate the map. A rejection is also cached, which is fine: every
  // entry that depends on a broken profile/scenario will surface the
  // same error.
  const profileCache = new Map<string, Promise<ProfileDefinition>>();
  const scenarioCache = new Map<string, Promise<ScenarioDefinition>>();

  function getProfile(ref: string, id: string): Promise<ProfileDefinition> {
    let pending = profileCache.get(id);
    if (pending === undefined) {
      pending = loadProfileDefinition(params.packageRoot, ref, id, contributionsRegistry);
      profileCache.set(id, pending);
    }
    return pending;
  }
  function getScenario(ref: string, id: string): Promise<ScenarioDefinition> {
    let pending = scenarioCache.get(id);
    if (pending === undefined) {
      pending = loadScenarioDefinition(params.packageRoot, ref, id);
      scenarioCache.set(id, pending);
    }
    return pending;
  }

  const total = entries.length;
  // Pre-sized so out-of-order completions land in submission-order slots.
  const reports: (MatrixRunReport | undefined)[] = new Array(total).fill(undefined);
  const startedAt = new Date();
  const perRunTimeoutMs = params.spec.environment.timeout_per_run_seconds * 1000;
  const runSingleRunImpl = params.runSingleRunFn ?? runSingleRun;
  const tracker = new BudgetTracker(params.spec.environment.max_total_cost_usd);

  async function runMatrixEntry(entry: MatrixEntry, idx: number): Promise<void> {
    params.onRunStart?.(entry, idx + 1, total);
    let report: MatrixRunReport;

    // Pre-flight cost-cap short-circuit. After the tracker flips, no new run
    // is started; in-flight workers already past this gate are allowed to
    // finish (Pi has no clean per-session cancel). Skipped runs still emit
    // a `summary.json` stub so the bundle's "rows in CSV = matrix size"
    // contract holds — see the BudgetExceededError catch in the CLI loop.
    if (tracker.aborted) {
      const err = new BudgetExceededError(tracker.buildSkipReason());
      try {
        await bundleWriter.initRun(entry.runConfig);
        await writeRunSummary(bundleWriter, entry.runConfig.runId, {
          run_id: entry.runConfig.runId,
          status: "error",
          error: { name: err.name, message: err.message },
        });
        await bundleWriter.finalizeRun(entry.runConfig.runId);
      } catch {
        // Best-effort: if config.yaml or run dir failed, the manifest still
        // gets the error report below, just without a per-run summary.json.
      }
      report = {
        runConfig: entry.runConfig,
        status: "error",
        error: { name: err.name, message: err.message },
      };
      reports[idx] = report;
      params.onRunEnd?.(report, idx + 1, total);
      return;
    }

    try {
      const profileDef = await getProfile(entry.profileRef, entry.runConfig.profileId);
      const scenarioDef = await getScenario(
        entry.scenarioRef,
        entry.runConfig.scenarioId,
      );
      const outcome = await runSingleRunImpl({
        spec: params.spec,
        runConfig: entry.runConfig,
        modelLevel: entry.modelLevel,
        scenarioDef,
        profileDef,
        bundleWriter,
        timeoutMs: perRunTimeoutMs,
        // Single-source-of-truth timeout: the oracle inherits the per-run
        // wall-clock budget; the module-level fallback in
        // `src/evaluator/oracle.ts` covers direct callers only.
        oracleTimeoutMs: perRunTimeoutMs,
        packageRoot: params.packageRoot,
        harness: loaded.adapter,
        ...(loaded.register !== undefined ? { harnessRegister: loaded.register } : {}),
        ...(params.apiKeys !== undefined ? { apiKeys: params.apiKeys } : {}),
      });
      tracker.recordRun(outcome.costUsd);
      const status: RunStatus = deriveStatus({
        sessionTimedOut: outcome.timedOut,
        oracleTimedOut: outcome.evaluation.timedOut,
        tasksPassed: outcome.evaluation.tasksPassed,
        tasksTotal: outcome.evaluation.tasksTotal,
        hardError: false,
      });
      report = {
        runConfig: entry.runConfig,
        status,
        durationMs: outcome.durationMs,
        tokensIn: outcome.tokensIn,
        tokensOut: outcome.tokensOut,
        tokensTotal: outcome.tokensTotal,
        costUsd: outcome.costUsd,
        clarificationRequestsCount: outcome.clarificationRequestsCount,
        tasksPassed: outcome.evaluation.tasksPassed,
        tasksTotal: outcome.evaluation.tasksTotal,
        regressionTestsPassed: outcome.evaluation.regressionPassed,
        regressionTestsTotal: outcome.evaluation.regressionTotal,
        // Pass the full Layer2Metrics through. The manifest writer
        // flattens profile_metrics on serialization (Bullets 4.2/4.3).
        layer2: outcome.layer2,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      try {
        await writeRunSummary(bundleWriter, entry.runConfig.runId, {
          run_id: entry.runConfig.runId,
          status: "error",
          error: { name: err.name, message: err.message },
        });
      } catch {
        // Best-effort: if config.yaml or run dir were never created, skip summary.
      }
      report = {
        runConfig: entry.runConfig,
        status: "error",
        error: { name: err.name, message: err.message },
      };
    }
    reports[idx] = report;
    params.onRunEnd?.(report, idx + 1, total);
  }

  const parallelism = Math.max(1, Math.floor(params.spec.design.parallelism));
  await runWithLimit(entries, parallelism, runMatrixEntry);

  // Pool guarantees every index ran exactly once, but keep a defensive
  // collapse so a missing slot would surface as an explicit error report
  // instead of an undefined leak in the manifest builder.
  const finalReports: MatrixRunReport[] = reports.map((r, i) => {
    if (r !== undefined) return r;
    const entry = entries[i];
    return {
      runConfig:
        entry?.runConfig ?? {
          runId: formatRunId(i + 1),
          promptId: "",
          profileId: "",
          modelLevelId: "",
          provider: "",
          modelId: "",
          scenarioId: "",
          repetition: 0,
        },
      status: "error",
      error: {
        name: "PoolMissError",
        message: `runMatrixEntry never produced a report for index ${i}`,
      },
    };
  });

  const finishedAt = new Date();
  const runResults: MatrixRunResults = {
    packageRoot: params.packageRoot,
    startedAt,
    finishedAt,
    reports: finalReports,
    installedHarnessVersion: loaded.adapter.version,
  };
  const manifest = await writeManifest(bundleWriter.bundlePath, params.spec, runResults);
  await emitAggregatedOutputs(bundleWriter.bundlePath, params.spec);
  const skippedCount = finalReports.reduce(
    (n, r) => n + (r.error?.name === "BudgetExceededError" ? 1 : 0),
    0,
  );

  return {
    bundlePath: bundleWriter.bundlePath,
    reports: finalReports,
    manifest,
    startedAt,
    finishedAt,
    abortReason: tracker.abortReason,
    skippedCount,
  };
}
