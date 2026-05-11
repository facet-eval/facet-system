import type {
  AgentSessionEvent,
  ExtensionFactory,
} from "@mariozechner/pi-coding-agent";

import type { TraceEvent } from "@facet/sdk/trace-event";

export type PiEvent = AgentSessionEvent;

export interface PiSessionConfig {
  readonly tools: readonly string[];
  readonly systemPrompt: string;
  readonly provider: string;
  readonly modelId: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly additionalExtensionPaths?: readonly string[];
  readonly extensionFactories?: readonly ExtensionFactory[];
  // Optional Markdown blocks prepended to every assistant turn via
  // DefaultResourceLoader.appendSystemPromptOverride. Populated by the
  // generic upfront-context exec wrapper (`src/runner/upfront-context.ts`)
  // from each profile's `upfront_context:` declaration.
  readonly appendSystemPrompts?: readonly string[];
  // Per-run override of `getAgentDir()`. Two production callers:
  //   1. The hermeticity regression test (`tests/extensions.test.ts`) stages
  //      a fake auto-discoverable extension under a tmp dir and asserts
  //      `noExtensions:true` suppresses it — this is the original "test
  //      seam" the field's name suggests.
  //   2. `src/runner/agent-pin.ts` (Phase 5; today still
  //      `subagents-pin.ts`) writes per-run pinned agent files into a
  //      tmp dir and points `agentDir` at it so each run uses an isolated
  //      `agents/` set without polluting `~/.pi/agent/agents/`.
  // The B-03 follow-up that renamed the JSDoc closes the audit's
  // "production code uses test seam" concern; both uses are first-class.
  readonly agentDir?: string;
  // Per-run harness param overrides bound by `model_param` factors
  // (Phase 6 / F-58). Keys are harness-param names (e.g. `temperature`,
  // `top_p`); values are whatever the spec author declared (number, string,
  // or boolean — see `ModelParamLevelSchema`).
  //
  // Pi 0.70.0 does not expose a public knob for any of these params on
  // `createAgentSession`; the runner threads them through so a future Pi
  // version (or a different harness) can pick them up without a framework
  // edit. Today the adapter logs a `harness-param-unsupported` warning per
  // applied param and otherwise ignores them — the values are still
  // recorded in `runs/<id>/config.yaml` for traceability.
  readonly harnessParams?: Readonly<Record<string, unknown>>;
}

export interface PiTokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
}

export interface PiSessionResult {
  readonly finalMessage: string | undefined;
  // Translated FACET-shaped events. The adapter converts each Pi event via
  // `translateEvent` before passing it on; downstream consumers (tracer,
  // evaluator, runner result reducer) never see Pi-typed events.
  readonly events: readonly TraceEvent[];
  readonly tokenUsage: PiTokenUsage;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly costUsd: number;
  readonly clarificationRequestsCount: number;
  // Resolved model.contextWindow at session start. The Pi SDK declares this
  // field as optional on model overrides, so 0 means "unknown" and disables
  // context-utilization metrics in the layer-2 derivation.
  readonly contextWindow: number;
}
