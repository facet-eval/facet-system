// @facet/sdk — harness.ts
//
// Public contract for harness adapters. A harness implementation (today
// only Pi via `@facet/harness-pi`) provides a typed driver around a code
// agent SDK and translates its native events into FACET-shaped TraceEvents
// at the adapter boundary. The runner never sees harness-native event
// types; it only ever consumes the FACET TraceEvent union.

import type { TraceEvent } from "./trace-event.js";

// ts-prune-ignore-next
export interface HarnessRunConfig {
  readonly provider: string;
  readonly modelId: string;
  // Provider-keyed credential. The runner reads `${PROVIDER}_API_KEY` from
  // the environment and passes the resolved value here. Optional so the
  // adapter can decide whether the underlying SDK accepts a fallback.
  readonly apiKey?: string;
  readonly tools: readonly string[];
  readonly systemPrompt: string;
  // Per-run timeout (set from `spec.environment.timeout_per_run_seconds`).
  // The adapter is responsible for aborting the session and surfacing
  // `timedOut: true` in the result when the budget is exceeded.
  readonly timeoutMs?: number;
  // Per-run harness param overrides bound by `model_param` factors. Keys
  // are param names declared by the spec (e.g. `temperature`); values are
  // whatever the spec author declared. Adapters that cannot apply a param
  // should warn (`harness-param-unsupported`) and still surface the value
  // in run config for traceability.
  readonly harnessParams?: Readonly<Record<string, unknown>>;
  // Adapter-specific extras threaded through by the runner from profile
  // contributions (e.g. Pi reads `agentDir`, `additionalExtensionPaths`,
  // `extensionFactories`, `appendSystemPrompts`). Each key corresponds to
  // an ExtensionsContribution the harness registered; adapters ignore keys
  // they do not understand. The SDK keeps the shape open on purpose so a
  // new harness can declare its own keys without a framework edit.
  readonly extras?: Readonly<Record<string, unknown>>;
  // Absolute path to the experiment package root (the directory that
  // contains `spec.yaml`). Framework-level metadata — not harness-specific
  // — so adapters can resolve package-local files by their own convention
  // (e.g. Pi reads `<packageRoot>/models.json` to extend its model
  // registry without forcing the user to edit `~/.pi/agent/models.json`).
  // Optional because back-compat test seams construct configs without a
  // package; production callers always populate it.
  readonly packageRoot?: string;
}

// ts-prune-ignore-next
export interface HarnessTokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
}

// ts-prune-ignore-next
export interface HarnessRunResult {
  readonly finalMessage: string | undefined;
  // FACET-shaped events translated by the adapter. Downstream consumers
  // (tracer, evaluator) read this exclusively.
  readonly events: readonly TraceEvent[];
  readonly tokenUsage: HarnessTokenUsage;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly costUsd: number;
  // Count of clarification re-prompts the adapter issued during the run.
  // Adapters that do not implement a clarification loop return 0.
  readonly clarificationRequestsCount: number;
  // Resolved model context window at session start. 0 means "unknown" and
  // disables context-utilization metrics in the layer-2 derivation.
  readonly contextWindow: number;
}

// ts-prune-ignore-next
export interface HarnessAdapter {
  // Stable harness id surfaced in the trace's `_meta` line and in the
  // manifest provenance block. Must match the `id` declared in the spec's
  // `metadata.harness` (after Phase 13.2).
  readonly id: string;
  // Resolved version of the underlying agent SDK the adapter wraps. The
  // validator cross-checks this against `spec.metadata.harness.version`.
  readonly version: string;
  runSession(
    config: HarnessRunConfig,
    userPrompt: string,
    cwd: string,
    onEvent?: (event: TraceEvent) => void,
  ): Promise<HarnessRunResult>;
}

// ts-prune-ignore-next
export function defineHarness(adapter: HarnessAdapter): HarnessAdapter {
  return adapter;
}
