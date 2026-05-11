// @facet/sdk — metric-kind.ts
//
// Public contract for metric kinds — the data-side discriminator that
// drives `extensions.yaml.metrics[].kind` in a profile (or a comparable
// declaration site introduced by a harness). A metric kind handler folds
// the trace event stream into a single numeric value via
// `initialState` → `evaluate(event, state, config)` per consumed event →
// `finalize(state, config)`.
//
// The handler declares which trace event kinds it consumes via the
// `consumes` field. The MetricRulesAccumulator dispatches each event to
// the union of handlers whose `consumes` includes the event's `type`,
// keeping the per-rule state isolated. Plugin authors register new kinds
// without touching the layer-2 dispatcher.

import type { ZodType } from "zod";

import type { TraceEvent } from "./trace-event.js";

// Open-ended state shape — the handler owns it. The accumulator never
// inspects the state directly; it passes it back into `evaluate` and
// `finalize` verbatim.
// ts-prune-ignore-next
export type MetricKindState = unknown;

// ts-prune-ignore-next
export interface MetricKindHandler<TConfig = unknown> {
  // Discriminator value, e.g. "tool_call_count", "turn_latency_p95".
  // Surfaces in `extensions.yaml.metrics[].kind` and must be unique
  // within the active registry.
  readonly id: string;
  // Validates the per-rule configuration (everything beyond `id` and
  // `kind` in an `extensions.yaml.metrics[]` entry). The metric-rule
  // registry composes this with the rule envelope at spec load time.
  readonly configSchema: ZodType<TConfig>;
  // Trace event `type`s this handler reads. The accumulator skips
  // dispatching events whose `type` is not in this list — that is the
  // performance contract that lets the framework run dozens of metric
  // rules without scanning the full stream per rule.
  readonly consumes: readonly string[];
  // Initial accumulator state for a single rule instance. Called once
  // per rule per run; the result is passed to `evaluate` on every
  // dispatched event.
  initialState(config: TConfig): MetricKindState;
  // Fold an event into the running state. Returning the same reference
  // is allowed (in-place mutation); returning a new object is allowed
  // too. The accumulator does not snapshot — whatever you return
  // becomes the next state.
  evaluate(
    event: TraceEvent,
    state: MetricKindState,
    config: TConfig,
  ): MetricKindState;
  // Project the final accumulator state to a single number for the
  // metric. Called once after the stream is exhausted. The number lands
  // in `metrics.json.profile_metrics[rule.id]` and the aggregated CSV.
  finalize(state: MetricKindState, config: TConfig): number;
}

// ts-prune-ignore-next
export function defineMetricKind<TConfig>(
  handler: MetricKindHandler<TConfig>,
): MetricKindHandler<TConfig> {
  return handler;
}
