// FACET-owned trace event vocabulary.
//
// This is the on-disk shape that `trace.jsonl` carries — independent of any
// specific harness's internal types. A harness adapter (today only `pi`) is
// responsible for translating its native events into `TraceEvent` at the
// adapter boundary; downstream consumers (layer-2 metrics, future analysis
// layers, UIs) read this shape exclusively.
//
// Closed discriminated union. Adding a sixth `type` is a deliberate
// framework change, not a profile-side knob — analogous to the closed
// "metric kinds" the upcoming Phase 4 registry will use.
//
// Architecture-doc anchor: closes F-18 / F-21 / F-25 / F-26 from
// `docs/audits/profile-coupling-audit-2026-05-04-consolidated.md`. Until
// this file existed, the Tracer accepted the harness's native event type
// directly and the on-disk trace format was tied to that package's private
// types.

export const TRACE_VERSION = 1 as const;

export interface TraceMetaLine {
  readonly _meta: {
    readonly trace_version: number;
    readonly harness: string;
    readonly harness_version: string;
  };
}

interface TraceEventBase {
  readonly type: string;
  // ISO-8601 wall-clock timestamp at translation time. Translators stamp
  // this before writing; readers may use it for ordering when the file is
  // re-played out of order, but the JSONL line order remains authoritative
  // for in-process derivations.
  readonly timestamp: string;
}

export interface AgentStartTraceEvent extends TraceEventBase {
  readonly type: "agent_start";
}

export interface TurnStartTraceEvent extends TraceEventBase {
  readonly type: "turn_start";
}

export interface TurnEndTraceEvent extends TraceEventBase {
  readonly type: "turn_end";
  readonly tokenUsage?: {
    readonly input?: number;
    readonly output?: number;
  };
}

export interface ToolExecutionStartTraceEvent extends TraceEventBase {
  readonly type: "tool_execution_start";
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly args?: Record<string, unknown>;
}

export interface ToolExecutionEndTraceEvent extends TraceEventBase {
  readonly type: "tool_execution_end";
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly result?: {
    readonly content?: ReadonlyArray<{
      readonly type?: string;
      readonly text?: string;
    }>;
  };
  readonly isError?: boolean;
}

export interface MessageTextDeltaTraceEvent extends TraceEventBase {
  readonly type: "message_text_delta";
  readonly text?: string;
}

export type TraceEvent =
  | AgentStartTraceEvent
  | TurnStartTraceEvent
  | TurnEndTraceEvent
  | ToolExecutionStartTraceEvent
  | ToolExecutionEndTraceEvent
  | MessageTextDeltaTraceEvent;

export type TraceEventType = TraceEvent["type"];

export const TRACE_EVENT_TYPES: readonly TraceEventType[] = [
  "agent_start",
  "turn_start",
  "turn_end",
  "tool_execution_start",
  "tool_execution_end",
  "message_text_delta",
] as const;

export function isTraceMetaLine(parsed: unknown): parsed is TraceMetaLine {
  if (typeof parsed !== "object" || parsed === null) return false;
  const meta = (parsed as Record<string, unknown>)._meta;
  if (typeof meta !== "object" || meta === null) return false;
  const m = meta as Record<string, unknown>;
  return (
    typeof m.trace_version === "number" &&
    typeof m.harness === "string" &&
    typeof m.harness_version === "string"
  );
}

export function isTraceEvent(parsed: unknown): parsed is TraceEvent {
  if (typeof parsed !== "object" || parsed === null) return false;
  const t = (parsed as Record<string, unknown>).type;
  if (typeof t !== "string") return false;
  return (TRACE_EVENT_TYPES as readonly string[]).includes(t);
}
