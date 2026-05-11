import { describe, expect, it } from "vitest";

import { translateEvent } from "@facet/harness-pi/translate";
import type { PiEvent } from "@facet/harness-pi/types";

// The translator is a duck-typed boundary: Pi's `AgentSessionEvent` is a wide
// union we cannot easily fake at the type level, so we cast through `unknown`
// at each construction site. The runtime checks inside `translateEvent`
// guarantee shape correctness regardless of the static cast.
function asPiEvent(value: object): PiEvent {
  return value as unknown as PiEvent;
}

describe("translateEvent — Pi → FACET", () => {
  it("translates agent_start", () => {
    const out = translateEvent(asPiEvent({ type: "agent_start" }));
    expect(out?.type).toBe("agent_start");
    expect(out?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("translates turn_start", () => {
    const out = translateEvent(asPiEvent({ type: "turn_start" }));
    expect(out?.type).toBe("turn_start");
  });

  it("translates turn_end with usage to a tokenUsage payload", () => {
    const out = translateEvent(
      asPiEvent({
        type: "turn_end",
        message: { usage: { input: 100, output: 50 } },
      }),
    );
    expect(out?.type).toBe("turn_end");
    if (out?.type === "turn_end") {
      expect(out.tokenUsage).toEqual({ input: 100, output: 50 });
    }
  });

  it("translates turn_end without usage to an event without tokenUsage", () => {
    const out = translateEvent(asPiEvent({ type: "turn_end" }));
    expect(out?.type).toBe("turn_end");
    if (out?.type === "turn_end") {
      expect(out.tokenUsage).toBeUndefined();
    }
  });

  it("translates tool_execution_start preserving toolName/args", () => {
    const out = translateEvent(
      asPiEvent({
        type: "tool_execution_start",
        toolCallId: "abc",
        toolName: "bash",
        args: { command: "ls" },
      }),
    );
    expect(out?.type).toBe("tool_execution_start");
    if (out?.type === "tool_execution_start") {
      expect(out.toolCallId).toBe("abc");
      expect(out.toolName).toBe("bash");
      expect(out.args).toEqual({ command: "ls" });
    }
  });

  it("translates tool_execution_end and copies content[].text items", () => {
    const out = translateEvent(
      asPiEvent({
        type: "tool_execution_end",
        toolCallId: "abc",
        toolName: "write",
        result: {
          content: [
            { type: "text", text: "ok" },
            { type: "text", text: "⚠️ lens warning" },
            { type: "image", url: "ignored" },
          ],
        },
        isError: false,
      }),
    );
    expect(out?.type).toBe("tool_execution_end");
    if (out?.type === "tool_execution_end") {
      expect(out.toolName).toBe("write");
      expect(out.isError).toBe(false);
      expect(out.result?.content).toEqual([
        { type: "text", text: "ok" },
        { type: "text", text: "⚠️ lens warning" },
        { type: "image" },
      ]);
    }
  });

  it("translates a text_delta message_update to message_text_delta", () => {
    const out = translateEvent(
      asPiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", text: "hi" },
      }),
    );
    expect(out?.type).toBe("message_text_delta");
    if (out?.type === "message_text_delta") {
      expect(out.text).toBe("hi");
    }
  });

  it("returns null for non-text-delta message_update events", () => {
    expect(
      translateEvent(
        asPiEvent({
          type: "message_update",
          assistantMessageEvent: { type: "tool_call", toolName: "bash" },
        }),
      ),
    ).toBeNull();
  });

  it("returns null for unknown Pi event types", () => {
    expect(translateEvent(asPiEvent({ type: "session_start" }))).toBeNull();
    expect(translateEvent(asPiEvent({ type: "totally_made_up" }))).toBeNull();
  });
});
