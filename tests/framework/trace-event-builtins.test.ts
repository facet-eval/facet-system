import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError, z } from "zod";

import { agentStartTraceEventKind } from "@facet/core/builtins/trace-events/agent-start.js";
import { messageTextDeltaTraceEventKind } from "@facet/core/builtins/trace-events/message-text-delta.js";
import { toolExecutionEndTraceEventKind } from "@facet/core/builtins/trace-events/tool-execution-end.js";
import { toolExecutionStartTraceEventKind } from "@facet/core/builtins/trace-events/tool-execution-start.js";
import { turnEndTraceEventKind } from "@facet/core/builtins/trace-events/turn-end.js";
import { turnStartTraceEventKind } from "@facet/core/builtins/trace-events/turn-start.js";
import {
  buildTraceEventSchema,
  UnknownTraceEventKindError,
  validateTraceEvent,
} from "@facet/core/registries/trace-event-schemas.js";
import { createTraceEventRegistry } from "@facet/core/registries/trace-event-registry.js";
import { defineTraceEventKind } from "@facet/sdk/trace-event";
import { Tracer } from "@facet/core/tracer/index.js";

// Bullet 12.5: trace event kinds open via the registry, with the
// Tracer validating each event against the registered schema.

describe("Bullet 12.5 — trace event builtins + tracer validation", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "facet-tracer-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("builds a discriminated union over the six core builtins", () => {
    const registry = createTraceEventRegistry();
    registry.register(agentStartTraceEventKind);
    registry.register(turnStartTraceEventKind);
    registry.register(turnEndTraceEventKind);
    registry.register(toolExecutionStartTraceEventKind);
    registry.register(toolExecutionEndTraceEventKind);
    registry.register(messageTextDeltaTraceEventKind);

    const schema = buildTraceEventSchema(registry);
    const ts = new Date().toISOString();
    expect(schema.parse({ type: "agent_start", timestamp: ts })).toMatchObject({
      type: "agent_start",
    });
    expect(
      schema.parse({
        type: "tool_execution_start",
        timestamp: ts,
        toolName: "read",
      }),
    ).toMatchObject({ toolName: "read" });
    expect(() =>
      schema.parse({ type: "unknown_kind", timestamp: ts }),
    ).toThrow();
  });

  it("validateTraceEvent throws UnknownTraceEventKindError for missing/unknown types", () => {
    const registry = createTraceEventRegistry();
    registry.register(agentStartTraceEventKind);

    expect(() => validateTraceEvent({}, registry)).toThrow(
      UnknownTraceEventKindError,
    );
    expect(() =>
      validateTraceEvent({ type: "ghost", timestamp: "ts" }, registry),
    ).toThrow(UnknownTraceEventKindError);
  });

  it("validateTraceEvent throws ZodError for malformed payloads", () => {
    const registry = createTraceEventRegistry();
    registry.register(toolExecutionEndTraceEventKind);

    // `result.content[]` requires each entry to be an object with optional
    // `type/text`; passing a string violates the schema.
    expect(() =>
      validateTraceEvent(
        {
          type: "tool_execution_end",
          timestamp: new Date().toISOString(),
          result: { content: ["not-an-object"] },
        },
        registry,
      ),
    ).toThrow(ZodError);
  });

  it("Tracer with a configured registry persists builtins and rejects unknown kinds", async () => {
    const registry = createTraceEventRegistry();
    registry.register(agentStartTraceEventKind);
    registry.register(turnStartTraceEventKind);
    registry.register(turnEndTraceEventKind);
    registry.register(toolExecutionStartTraceEventKind);
    registry.register(toolExecutionEndTraceEventKind);
    registry.register(messageTextDeltaTraceEventKind);

    const outputPath = path.join(tmp, "trace.jsonl");
    const tracer = new Tracer({
      outputPath,
      harness: "test-fake",
      harnessVersion: "0.0.0",
      traceEventRegistry: registry,
    });
    const ts = new Date().toISOString();
    tracer.record({ type: "agent_start", timestamp: ts });
    tracer.record({ type: "turn_start", timestamp: ts });
    tracer.record({
      type: "turn_end",
      timestamp: ts,
      tokenUsage: { input: 100, output: 50 },
    });
    expect(() =>
      tracer.record({ type: "ghost_kind", timestamp: ts } as never),
    ).toThrow(UnknownTraceEventKindError);
    tracer.close();

    const lines = (await readFile(outputPath, "utf8"))
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines.length).toBe(4); // _meta + 3 valid events
    const meta = JSON.parse(lines[0]!);
    expect(meta._meta.harness).toBe("test-fake");
    expect(JSON.parse(lines[1]!).type).toBe("agent_start");
    expect(JSON.parse(lines[3]!).tokenUsage.input).toBe(100);
  });

  it("registers a plugin-declared gpu_telemetry kind and validates re-read JSONL", async () => {
    const registry = createTraceEventRegistry();
    // The harness fake only emits gpu_telemetry in this test; we don't
    // need the six builtins for this case.
    const gpuTelemetry = defineTraceEventKind({
      id: "gpu_telemetry",
      schema: z
        .object({
          type: z.literal("gpu_telemetry"),
          timestamp: z.string().min(1),
          gpu_id: z.number().int().nonnegative(),
          mem_mb: z.number().nonnegative(),
        })
        .strict(),
    });
    registry.register(gpuTelemetry);

    const outputPath = path.join(tmp, "gpu-trace.jsonl");
    const tracer = new Tracer({
      outputPath,
      harness: "fake-gpu-harness",
      harnessVersion: "0.0.0",
      traceEventRegistry: registry,
    });
    const ts = new Date().toISOString();
    tracer.record({
      type: "gpu_telemetry",
      timestamp: ts,
      gpu_id: 0,
      mem_mb: 4096,
    } as never);
    tracer.record({
      type: "gpu_telemetry",
      timestamp: ts,
      gpu_id: 1,
      mem_mb: 7800,
    } as never);
    tracer.close();

    const lines = (await readFile(outputPath, "utf8"))
      .split("\n")
      .filter((l) => l.length > 0);
    // _meta + 2 events
    expect(lines.length).toBe(3);

    // Re-read and validate against the registry — round-trip check.
    const schema = buildTraceEventSchema(registry);
    const event0 = JSON.parse(lines[1]!);
    const event1 = JSON.parse(lines[2]!);
    expect(schema.parse(event0)).toMatchObject({ gpu_id: 0, mem_mb: 4096 });
    expect(schema.parse(event1)).toMatchObject({ gpu_id: 1, mem_mb: 7800 });
  });

  it("Tracer without a registry preserves pre-12.5 behavior (no validation)", async () => {
    const outputPath = path.join(tmp, "untyped-trace.jsonl");
    const tracer = new Tracer({
      outputPath,
      harness: "test-fake",
      harnessVersion: "0.0.0",
    });
    const ts = new Date().toISOString();
    // No registry → tracer accepts anything that serializes.
    tracer.record({ type: "agent_start", timestamp: ts });
    tracer.record({ type: "ghost_kind", timestamp: ts } as never);
    tracer.close();

    const lines = (await readFile(outputPath, "utf8"))
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines.length).toBe(3);
  });
});
