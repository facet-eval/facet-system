import { describe, expect, it } from "vitest";

import {
  CLARIFICATION_FALLBACK_TEXT,
  MAX_CLARIFICATION_FALLBACKS,
  driveClarificationLoop,
  shutdownPiSession,
  type ClarificationDriverSession,
  type DisposablePiSession,
} from "@facet/harness-pi";
import type { PiEvent } from "@facet/harness-pi/types";

interface FakeSession extends ClarificationDriverSession {
  readonly promptCalls: string[];
  readonly subscribers: number;
}

function makeFakeSession(scripts: readonly (readonly PiEvent[])[]): FakeSession {
  const promptCalls: string[] = [];
  let listener: ((event: PiEvent) => void) | undefined;
  let subscribers = 0;
  const fake: FakeSession = {
    promptCalls,
    get subscribers() {
      return subscribers;
    },
    subscribe(l) {
      listener = l;
      subscribers += 1;
      return () => {
        if (listener === l) listener = undefined;
        subscribers -= 1;
      };
    },
    async prompt(text) {
      promptCalls.push(text);
      const idx = promptCalls.length - 1;
      const script = scripts[idx] ?? [];
      for (const event of script) {
        listener?.(event);
      }
    },
  };
  return fake;
}

const agentStart = (): PiEvent =>
  ({ type: "agent_start" }) as unknown as PiEvent;

const agentEnd = (): PiEvent =>
  ({ type: "agent_end", messages: [] }) as unknown as PiEvent;

const textDelta = (delta: string): PiEvent =>
  ({
    type: "message_update",
    message: {},
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta,
      partial: {},
    },
  }) as unknown as PiEvent;

const toolStart = (toolName = "bash"): PiEvent =>
  ({
    type: "tool_execution_start",
    toolCallId: "tc-1",
    toolName,
    args: {},
  }) as unknown as PiEvent;

const passiveTurn = (): PiEvent[] => [
  agentStart(),
  textDelta("I need more details."),
  agentEnd(),
];

describe("clarification fallback constants", () => {
  it("the fallback text matches study-design.md §6 verbatim", () => {
    expect(CLARIFICATION_FALLBACK_TEXT).toBe(
      "Proceed with what you have. No additional information is available. Use your judgment to complete the task.",
    );
  });

  it("the fallback cap is 3", () => {
    expect(MAX_CLARIFICATION_FALLBACKS).toBe(3);
  });
});

describe("driveClarificationLoop", () => {
  it("re-prompts up to the cap when the model emits text but no tool call", async () => {
    const session = makeFakeSession([
      passiveTurn(),
      passiveTurn(),
      passiveTurn(),
      passiveTurn(),
    ]);

    const result = await driveClarificationLoop(session, {
      userPrompt: "hello",
      fallbackText: CLARIFICATION_FALLBACK_TEXT,
      maxFallbacks: MAX_CLARIFICATION_FALLBACKS,
    });

    expect(result.clarificationRequestsCount).toBe(MAX_CLARIFICATION_FALLBACKS);
    expect(session.promptCalls).toEqual([
      "hello",
      CLARIFICATION_FALLBACK_TEXT,
      CLARIFICATION_FALLBACK_TEXT,
      CLARIFICATION_FALLBACK_TEXT,
    ]);
    expect(session.subscribers).toBe(0);
  });

  it("does not increment when a tool_execution_start fires", async () => {
    const session = makeFakeSession([
      [agentStart(), toolStart(), textDelta("ok"), agentEnd()],
    ]);

    const result = await driveClarificationLoop(session, {
      userPrompt: "hello",
      fallbackText: CLARIFICATION_FALLBACK_TEXT,
      maxFallbacks: MAX_CLARIFICATION_FALLBACKS,
    });

    expect(result.clarificationRequestsCount).toBe(0);
    expect(session.promptCalls).toEqual(["hello"]);
  });

  it("does not increment when the assistant emits no text at all", async () => {
    const session = makeFakeSession([[agentStart(), agentEnd()]]);

    const result = await driveClarificationLoop(session, {
      userPrompt: "hello",
      fallbackText: CLARIFICATION_FALLBACK_TEXT,
      maxFallbacks: MAX_CLARIFICATION_FALLBACKS,
    });

    expect(result.clarificationRequestsCount).toBe(0);
    expect(session.promptCalls).toEqual(["hello"]);
  });

  it("stops after a tool call appears, even mid-loop", async () => {
    const session = makeFakeSession([
      passiveTurn(),
      [agentStart(), toolStart("read"), agentEnd()],
      passiveTurn(),
    ]);

    const result = await driveClarificationLoop(session, {
      userPrompt: "hello",
      fallbackText: CLARIFICATION_FALLBACK_TEXT,
      maxFallbacks: MAX_CLARIFICATION_FALLBACKS,
    });

    expect(result.clarificationRequestsCount).toBe(1);
    expect(session.promptCalls).toEqual(["hello", CLARIFICATION_FALLBACK_TEXT]);
  });

  it("forwards every event through onEvent and unsubscribes when done", async () => {
    const session = makeFakeSession([passiveTurn()]);
    const seen: PiEvent[] = [];
    let fallbackHits = 0;

    await driveClarificationLoop(session, {
      userPrompt: "hello",
      fallbackText: CLARIFICATION_FALLBACK_TEXT,
      maxFallbacks: 0,
      onEvent: (event) => seen.push(event),
      onClarificationFallback: () => {
        fallbackHits += 1;
      },
    });

    expect(seen.map((e) => e.type)).toEqual([
      "agent_start",
      "message_update",
      "agent_end",
    ]);
    expect(fallbackHits).toBe(0);
    expect(session.subscribers).toBe(0);
  });

  it("respects shouldAbort and skips the fallback loop", async () => {
    const session = makeFakeSession([passiveTurn(), passiveTurn()]);

    const result = await driveClarificationLoop(session, {
      userPrompt: "hello",
      fallbackText: CLARIFICATION_FALLBACK_TEXT,
      maxFallbacks: MAX_CLARIFICATION_FALLBACKS,
      shouldAbort: () => true,
    });

    expect(result.clarificationRequestsCount).toBe(0);
    expect(session.promptCalls).toEqual(["hello"]);
  });

  it("invokes onClarificationFallback once per retry, before the prompt is sent", async () => {
    const fallbackCallTimings: number[] = [];
    const session = makeFakeSession([passiveTurn(), passiveTurn(), passiveTurn(), passiveTurn()]);

    await driveClarificationLoop(session, {
      userPrompt: "hello",
      fallbackText: CLARIFICATION_FALLBACK_TEXT,
      maxFallbacks: MAX_CLARIFICATION_FALLBACKS,
      onClarificationFallback: () => {
        fallbackCallTimings.push(session.promptCalls.length);
      },
    });

    // Each onClarificationFallback fires before the matching session.prompt
    // call. So the recorded "promptCalls.length at fire time" is 1, 2, 3:
    // initial prompt already sent, fallback prompt about to be sent.
    expect(fallbackCallTimings).toEqual([1, 2, 3]);
  });
});

describe("shutdownPiSession", () => {
  it("emits session_shutdown before dispose", async () => {
    const calls: string[] = [];
    const session: DisposablePiSession = {
      extensionRunner: {
        hasHandlers(eventType) {
          calls.push(`has:${eventType}`);
          return true;
        },
        async emit(event) {
          calls.push(`${event.type}:${event.reason}`);
        },
      },
      dispose() {
        calls.push("dispose");
      },
    };

    await shutdownPiSession(session);

    expect(calls).toEqual(["has:session_shutdown", "session_shutdown:quit", "dispose"]);
  });

  it("still disposes when no shutdown handler is registered", async () => {
    const calls: string[] = [];
    const session: DisposablePiSession = {
      extensionRunner: {
        hasHandlers(eventType) {
          calls.push(`has:${eventType}`);
          return false;
        },
        async emit(event) {
          calls.push(`${event.type}:${event.reason}`);
        },
      },
      dispose() {
        calls.push("dispose");
      },
    };

    await shutdownPiSession(session);

    expect(calls).toEqual(["has:session_shutdown", "dispose"]);
  });
});
