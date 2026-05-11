// Generic metric-kind dispatcher (Bullets 12.6 + 13.3).
//
// `runMetricKindsOverEvents(rules, registry, events)` walks the trace
// event stream once and, per event, dispatches it to every handler whose
// `consumes` includes the event's `type`. Each rule has its own private
// state (`initialState` per rule) that the dispatcher folds with the
// handler's `evaluate(event, state, config)`; at the end every rule's
// `finalize(state, config)` produces the numeric value that lands in
// `metrics.json.profile_metrics[rule.id]`.
//
// Bullet 13.3 made this the only production path: the previous closed
// switch in core's `src/evaluator/metric-rules.ts` was deleted and the
// kinds it understood moved to `@facet/harness-pi/metric-kinds/*`. A
// spec that references a kind the active harness adapter doesn't
// register fails fast here with "No metric-kind handler registered…".

import { ZodError, type ZodTypeAny } from "zod";

import type { MetricKindRegistry } from "./metric-kind-registry.js";

// ts-prune-ignore-next
export class MetricRuleConfigError extends Error {
  public readonly ruleId: string;
  public readonly kind: string;
  public override readonly cause?: ZodError;

  constructor(ruleId: string, kind: string, cause: ZodError) {
    super(
      `Invalid configuration for metric rule "${ruleId}" (kind "${kind}"): ` +
        cause.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; "),
    );
    this.name = "MetricRuleConfigError";
    this.ruleId = ruleId;
    this.kind = kind;
    this.cause = cause;
  }
}

// Open metric-rule shape: `{ id, kind, ...config }`. The dispatcher reads
// `id` and `kind`, looks up the handler, and validates the rest of the
// rule with `handler.configSchema`. Extra keys outside the config schema
// are rejected by `.strict()` schemas (recommended for plugin authors)
// and ignored by `.passthrough()` ones — the schema is the contract.
// ts-prune-ignore-next
export interface MetricRuleEnvelope {
  readonly id: string;
  readonly kind: string;
  readonly [extra: string]: unknown;
}

interface ResolvedRule {
  readonly id: string;
  readonly handler: ReturnType<MetricKindRegistry["get"]>;
  readonly config: unknown;
}

function resolveRules(
  rules: readonly MetricRuleEnvelope[],
  registry: MetricKindRegistry,
): ResolvedRule[] {
  const resolved: ResolvedRule[] = [];
  for (const rule of rules) {
    const handler = registry.get(rule.kind);
    if (handler === undefined) {
      throw new Error(
        `No metric-kind handler registered for kind "${rule.kind}" (rule id: "${rule.id}")`,
      );
    }
    // Strip `id` and `kind` from the envelope before validating with the
    // handler's configSchema; the handler's schema describes only the
    // configuration fields, not the envelope.
    const { id: _id, kind: _kind, ...config } = rule;
    let parsedConfig: unknown;
    try {
      const schema = handler.configSchema as ZodTypeAny;
      parsedConfig = schema.parse(config);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new MetricRuleConfigError(rule.id, rule.kind, e);
      }
      throw e;
    }
    resolved.push({ id: rule.id, handler, config: parsedConfig });
  }
  return resolved;
}

// ts-prune-ignore-next
export function runMetricKindsOverEvents(
  rules: readonly MetricRuleEnvelope[],
  registry: MetricKindRegistry,
  events: readonly { readonly type: string }[],
): Readonly<Record<string, number>> {
  const resolved = resolveRules(rules, registry);

  // Per-rule state. Initialized via `handler.initialState(config)`.
  const states = new Map<string, unknown>();
  // consumesIndex: event-type → list of rule ids subscribed to it.
  const consumesIndex = new Map<string, ResolvedRule[]>();
  for (const r of resolved) {
    states.set(r.id, r.handler!.initialState(r.config));
    for (const evType of r.handler!.consumes) {
      const bucket = consumesIndex.get(evType) ?? [];
      bucket.push(r);
      consumesIndex.set(evType, bucket);
    }
  }

  for (const event of events) {
    const subscribers = consumesIndex.get(event.type);
    if (subscribers === undefined) continue;
    for (const sub of subscribers) {
      const state = states.get(sub.id);
      const next = sub.handler!.evaluate(
        event as unknown as Parameters<NonNullable<typeof sub.handler>["evaluate"]>[0],
        state,
        sub.config,
      );
      states.set(sub.id, next);
    }
  }

  const out: Record<string, number> = {};
  for (const r of resolved.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    out[r.id] = r.handler!.finalize(states.get(r.id), r.config);
  }
  return out;
}
