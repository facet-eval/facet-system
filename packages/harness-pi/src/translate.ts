// Translates Pi's `AgentSessionEvent` into FACET's `TraceEvent`.
//
// Lives at the adapter boundary: Pi types stop here, the rest of the
// framework (tracer, evaluator, runner result shape) sees only the
// FACET-owned schema from `src/tracer/schema.ts`. When a future harness
// implementation lands, it will provide its own translator with the same
// shape and FACET need not change.
//
// Returns `null` for Pi event kinds FACET deliberately ignores
// (`session_start`, `session_end`, `message_update` of non-text-delta
// kinds, etc.). Consumers must guard for null.

import type { PiEvent } from "./types.js";
import type { TraceEvent } from "@facet/sdk/trace-event";

function nowIso(): string {
  return new Date().toISOString();
}

function pickArgs(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

interface ToolEndResult {
  readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
}

function pickResultContent(value: unknown): ToolEndResult | undefined {
  // Loose runtime shape carry-over: we copy the `content[].text` items as-is
  // when present. Pi's `result` carries a richer object (mime, attachments,
  // …) but layer-2 only consumes content text — keeping the shape narrow
  // here costs nothing and avoids leaking Pi internals.
  if (typeof value !== "object" || value === null) return undefined;
  const content = (value as Record<string, unknown>).content;
  if (!Array.isArray(content)) return undefined;
  const items = content
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const i = item as Record<string, unknown>;
      const out: { type?: string; text?: string } = {};
      if (typeof i.type === "string") out.type = i.type;
      if (typeof i.text === "string") out.text = i.text;
      return out;
    })
    .filter((item): item is { type?: string; text?: string } => item !== null);
  return { content: items };
}

export function translateEvent(piEvent: PiEvent): TraceEvent | null {
  const timestamp = nowIso();
  const e = piEvent as { type?: unknown } & Record<string, unknown>;
  switch (e.type) {
    case "agent_start":
      return { type: "agent_start", timestamp };

    case "turn_start":
      return { type: "turn_start", timestamp };

    case "turn_end": {
      const message = e.message;
      const usage =
        typeof message === "object" && message !== null
          ? (message as Record<string, unknown>).usage
          : undefined;
      if (typeof usage === "object" && usage !== null) {
        const u = usage as Record<string, unknown>;
        // SDK's `TraceEvent` is `TraceEventBase` only; concrete payloads
        // (tokenUsage, args, result, isError, …) are kind-specific and
        // structurally assignable to the base. Cast at return to keep the
        // literal-strict check from rejecting the extra fields.
        return {
          type: "turn_end",
          timestamp,
          tokenUsage: {
            ...(typeof u.input === "number" ? { input: u.input } : {}),
            ...(typeof u.output === "number" ? { output: u.output } : {}),
          },
        } as TraceEvent;
      }
      return { type: "turn_end", timestamp };
    }

    case "tool_execution_start": {
      return {
        type: "tool_execution_start",
        timestamp,
        ...(typeof e.toolCallId === "string" ? { toolCallId: e.toolCallId } : {}),
        ...(typeof e.toolName === "string" ? { toolName: e.toolName } : {}),
        ...(pickArgs(e.args) !== undefined ? { args: pickArgs(e.args)! } : {}),
      } as TraceEvent;
    }

    case "tool_execution_end": {
      const result = pickResultContent(e.result);
      return {
        type: "tool_execution_end",
        timestamp,
        ...(typeof e.toolCallId === "string" ? { toolCallId: e.toolCallId } : {}),
        ...(typeof e.toolName === "string" ? { toolName: e.toolName } : {}),
        ...(result !== undefined ? { result } : {}),
        ...(typeof e.isError === "boolean" ? { isError: e.isError } : {}),
      } as TraceEvent;
    }

    case "message_update": {
      const inner = e.assistantMessageEvent;
      if (typeof inner !== "object" || inner === null) return null;
      const i = inner as Record<string, unknown>;
      if (i.type !== "text_delta") return null;
      return {
        type: "message_text_delta",
        timestamp,
        ...(typeof i.text === "string" ? { text: i.text } : {}),
      } as TraceEvent;
    }

    default:
      return null;
  }
}
