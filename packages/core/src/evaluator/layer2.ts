import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import type { MetricRule } from "../runner/extensions.js";
import type { MetricKindRegistry } from "../registries/metric-kind-registry.js";
import { runMetricKindsOverEvents } from "../registries/metric-evaluator.js";
import {
  isTraceEvent,
  isTraceMetaLine,
  TRACE_VERSION,
  type ToolExecutionStartTraceEvent,
  type TraceEvent,
  type TurnEndTraceEvent,
} from "../tracer/schema.js";

export class Layer2Error extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "Layer2Error";
  }
}

export interface DeriveLayer2Input {
  readonly tracePath: string;
  readonly profileId: string;
  readonly contextWindow: number;
  readonly clarificationRequestsCount: number;
  // Profile-declared metric rules (Phase 4 / architecture doc §R1). Empty
  // when the profile declines to declare any — only the framework-static
  // metrics are populated in that case.
  readonly metricRules?: readonly MetricRule[];
  // Bullet 13.3 — registry of metric-kind handlers the harness adapter
  // populated via its `register(registries)` hook. The dispatcher
  // (`runMetricKindsOverEvents`) looks up each rule's `kind` here.
  // Without a registry, profile metrics are skipped entirely.
  readonly metricKindRegistry?: MetricKindRegistry;
}

// Framework-static metric set. Every run gets these regardless of profile.
// Profile-declared metrics live in `profile_metrics` and are flattened
// alongside these on disk via `flattenLayer2`.
export interface Layer2Metrics {
  readonly tool_calls_total: number;
  readonly tool_calls_per_type: Readonly<Record<string, number>>;
  readonly files_read_unique: number;
  readonly turns_to_first_edit: number | null;
  readonly repeated_file_edits: number;
  readonly clarification_requests_count: number;
  readonly bash_commands_count: number;
  readonly tokens_in_total: number;
  readonly tokens_out_total: number;
  readonly tokens_in_upfront: number;
  readonly context_window_size: number;
  readonly context_utilization_max_pct: number;
  readonly context_utilization_avg_pct: number;
  readonly profile_metrics: Readonly<Record<string, number>>;
}

const READ_PATH_KEYS: readonly string[] = ["path", "file_path", "filename"];

function extractPath(args: Record<string, unknown> | undefined): string | undefined {
  if (args === undefined) return undefined;
  for (const key of READ_PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

interface RunningCounters {
  toolCallsTotal: number;
  toolCallsPerType: Map<string, number>;
  filesReadUniqueBeforeFirstWrite: Set<string>;
  firstWriteSeen: boolean;
  turnsToFirstEdit: number | null;
  writeEditCountByPath: Map<string, number>;
  bashCommands: number;
  tokensInTotal: number;
  tokensOutTotal: number;
  tokensInUpfront: number | null;
  perTurnInputTokens: number[];
  currentTurnIndex: number;
}

function newCounters(): RunningCounters {
  return {
    toolCallsTotal: 0,
    toolCallsPerType: new Map(),
    filesReadUniqueBeforeFirstWrite: new Set(),
    firstWriteSeen: false,
    turnsToFirstEdit: null,
    writeEditCountByPath: new Map(),
    bashCommands: 0,
    tokensInTotal: 0,
    tokensOutTotal: 0,
    tokensInUpfront: null,
    perTurnInputTokens: [],
    currentTurnIndex: 0,
  };
}

function handleToolStart(c: RunningCounters, event: ToolExecutionStartTraceEvent): void {
  const toolName = event.toolName;
  if (typeof toolName !== "string" || toolName.length === 0) return;
  c.toolCallsTotal += 1;
  c.toolCallsPerType.set(toolName, (c.toolCallsPerType.get(toolName) ?? 0) + 1);

  if (toolName === "bash") c.bashCommands += 1;

  if (toolName === "read" && !c.firstWriteSeen) {
    const p = extractPath(event.args);
    if (p !== undefined) c.filesReadUniqueBeforeFirstWrite.add(p);
  }

  if (toolName === "write" || toolName === "edit") {
    if (!c.firstWriteSeen) {
      c.firstWriteSeen = true;
      // turn_start increments currentTurnIndex from 0 → 1, so the value
      // here is already the 1-indexed turn that the write happened in.
      c.turnsToFirstEdit = c.currentTurnIndex > 0 ? c.currentTurnIndex : 1;
    }
    const p = extractPath(event.args);
    if (p !== undefined) {
      c.writeEditCountByPath.set(p, (c.writeEditCountByPath.get(p) ?? 0) + 1);
    }
  }
}

function handleTurnEnd(c: RunningCounters, event: TurnEndTraceEvent): void {
  const usage = event.tokenUsage;
  if (usage === undefined) return;
  if (typeof usage.input === "number") {
    c.perTurnInputTokens.push(usage.input);
    c.tokensInTotal += usage.input;
    if (c.tokensInUpfront === null) c.tokensInUpfront = usage.input;
  }
  if (typeof usage.output === "number") {
    c.tokensOutTotal += usage.output;
  }
}

function buildResult(
  c: RunningCounters,
  contextWindow: number,
  clarifications: number,
  profileMetrics: Readonly<Record<string, number>>,
): Layer2Metrics {
  let repeated = 0;
  for (const count of c.writeEditCountByPath.values()) {
    if (count > 1) repeated += count - 1;
  }

  const safeWindow = contextWindow > 0 ? contextWindow : 0;
  let maxPct = 0;
  let avgPct = 0;
  if (safeWindow > 0 && c.perTurnInputTokens.length > 0) {
    let sumPct = 0;
    for (const tokens of c.perTurnInputTokens) {
      const pct = (tokens / safeWindow) * 100;
      if (pct > maxPct) maxPct = pct;
      sumPct += pct;
    }
    avgPct = sumPct / c.perTurnInputTokens.length;
  }

  const perType: Record<string, number> = {};
  for (const [name, count] of [...c.toolCallsPerType.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    perType[name] = count;
  }

  return {
    tool_calls_total: c.toolCallsTotal,
    tool_calls_per_type: perType,
    files_read_unique: c.filesReadUniqueBeforeFirstWrite.size,
    turns_to_first_edit: c.turnsToFirstEdit,
    repeated_file_edits: repeated,
    clarification_requests_count: clarifications,
    bash_commands_count: c.bashCommands,
    tokens_in_total: c.tokensInTotal,
    tokens_out_total: c.tokensOutTotal,
    tokens_in_upfront: c.tokensInUpfront ?? 0,
    context_window_size: safeWindow,
    context_utilization_max_pct: maxPct,
    context_utilization_avg_pct: avgPct,
    profile_metrics: profileMetrics,
  };
}

// Flattens `Layer2Metrics.profile_metrics` to top-level keys for the
// on-disk JSON / YAML artifacts. Downstream consumers see a uniform
// flat record (same shape pre- and post-Phase-4 for any single profile).
// The in-memory shape keeps the nested split so framework code can tell
// which keys are framework-static vs profile-declared.
export function flattenLayer2(metrics: Layer2Metrics): Record<string, unknown> {
  const { profile_metrics, ...rest } = metrics;
  return { ...rest, ...profile_metrics };
}

// Set of keys the framework itself populates on `Layer2Metrics`.
// Consumed by the aggregator (`src/bundle/aggregate.ts`) to tell which
// keys in metrics.json are framework-owned vs profile-declared — only
// the latter become dynamic CSV columns.
export const LAYER2_FRAMEWORK_KEYS: ReadonlySet<string> = new Set([
  "tool_calls_total",
  "tool_calls_per_type",
  "files_read_unique",
  "turns_to_first_edit",
  "repeated_file_edits",
  "clarification_requests_count",
  "bash_commands_count",
  "tokens_in_total",
  "tokens_out_total",
  "tokens_in_upfront",
  "context_window_size",
  "context_utilization_max_pct",
  "context_utilization_avg_pct",
]);

export async function deriveLayer2Metrics(input: DeriveLayer2Input): Promise<Layer2Metrics> {
  const counters = newCounters();
  // Bullet 13.3: collect trace events for the registry-based dispatcher
  // alongside the framework-static counter pass. Buffering the events in
  // memory is fine for current trace sizes (the bundle's stream cap is
  // 10 MB per stdout, traces are smaller still); larger workloads can
  // move to a two-pass approach if it ever matters.
  const events: TraceEvent[] = [];
  const stream = createReadStream(input.tracePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let metaSeen = false;
  try {
    let lineNumber = 0;
    for await (const rawLine of rl) {
      lineNumber += 1;
      const line = rawLine.trim();
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Layer2Error(
          `Trace ${input.tracePath} line ${lineNumber} is not valid JSON: ${(error as Error).message}`,
          { cause: error },
        );
      }
      // First non-empty JSON line must be the FACET trace meta record
      // (Bullet 3.4). Pre-Phase-3 traces and unsupported trace_versions
      // are rejected up-front so a downstream metric drift cannot be
      // silently absorbed.
      if (!metaSeen) {
        if (!isTraceMetaLine(parsed)) {
          throw new Layer2Error(
            `Trace ${input.tracePath} is missing the FACET _meta line (line ${lineNumber}); refuse to derive against an unversioned trace.`,
          );
        }
        if (parsed._meta.trace_version !== TRACE_VERSION) {
          throw new Layer2Error(
            `Trace ${input.tracePath} declares trace_version ${parsed._meta.trace_version}; this build supports ${TRACE_VERSION} (unsupported-trace-version).`,
          );
        }
        metaSeen = true;
        continue;
      }
      if (!isTraceEvent(parsed)) continue;
      const event: TraceEvent = parsed;
      events.push(event);
      switch (event.type) {
        case "turn_start":
          counters.currentTurnIndex += 1;
          break;
        case "tool_execution_start":
          handleToolStart(counters, event);
          break;
        case "turn_end":
          handleTurnEnd(counters, event);
          break;
        default:
          break;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  if (!metaSeen) {
    throw new Layer2Error(
      `Trace ${input.tracePath} is empty or contained no JSON; refuse to derive (unsupported-trace-version).`,
    );
  }
  const rules = input.metricRules ?? [];
  let profileMetrics: Readonly<Record<string, number>> = {};
  if (rules.length > 0 && input.metricKindRegistry !== undefined) {
    profileMetrics = runMetricKindsOverEvents(
      rules,
      input.metricKindRegistry,
      events,
    );
  }
  return buildResult(
    counters,
    input.contextWindow,
    input.clarificationRequestsCount,
    profileMetrics,
  );
}
