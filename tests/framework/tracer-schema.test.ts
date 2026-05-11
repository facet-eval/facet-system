import { describe, expect, it } from "vitest";

import {
  isTraceEvent,
  isTraceMetaLine,
  TRACE_EVENT_TYPES,
  TRACE_VERSION,
  type TraceEvent,
} from "@facet/core/tracer/schema.js";

describe("TraceEvent schema (FACET-owned)", () => {
  it("declares exactly 6 event types", () => {
    expect([...TRACE_EVENT_TYPES].sort()).toEqual(
      [
        "agent_start",
        "message_text_delta",
        "tool_execution_end",
        "tool_execution_start",
        "turn_end",
        "turn_start",
      ].sort(),
    );
  });

  it("pins TRACE_VERSION = 1", () => {
    expect(TRACE_VERSION).toBe(1);
  });
});

describe("isTraceMetaLine", () => {
  it("recognizes a well-formed meta object", () => {
    expect(
      isTraceMetaLine({
        _meta: {
          trace_version: 1,
          harness: "pi",
          harness_version: "0.70.0",
        },
      }),
    ).toBe(true);
  });

  it("rejects objects missing required meta fields", () => {
    expect(isTraceMetaLine({ _meta: {} })).toBe(false);
    expect(
      isTraceMetaLine({ _meta: { trace_version: 1, harness: "pi" } }),
    ).toBe(false);
    expect(isTraceMetaLine({})).toBe(false);
    expect(isTraceMetaLine(null)).toBe(false);
    expect(isTraceMetaLine("string")).toBe(false);
  });

  it("rejects a regular event line as a meta line", () => {
    expect(
      isTraceMetaLine({ type: "turn_start", timestamp: "2026-05-10T00:00:00Z" }),
    ).toBe(false);
  });
});

describe("isTraceEvent", () => {
  it("accepts every declared event type", () => {
    for (const type of TRACE_EVENT_TYPES) {
      expect(
        isTraceEvent({ type, timestamp: "2026-05-10T00:00:00Z" }),
      ).toBe(true);
    }
  });

  it("rejects events with an unknown type discriminant", () => {
    expect(
      isTraceEvent({ type: "totally_unknown", timestamp: "2026-05-10T00:00:00Z" }),
    ).toBe(false);
    expect(isTraceEvent({})).toBe(false);
    expect(isTraceEvent(null)).toBe(false);
  });

  it("recognizes a tool_execution_end event with optional content payload", () => {
    const event: TraceEvent = {
      type: "tool_execution_end",
      timestamp: "2026-05-10T00:00:00Z",
      toolCallId: "abc",
      toolName: "write",
      result: {
        content: [{ type: "text", text: "ok" }],
      },
      isError: false,
    };
    expect(isTraceEvent(event)).toBe(true);
  });
});
