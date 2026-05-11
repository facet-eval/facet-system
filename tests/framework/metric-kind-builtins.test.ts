import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toolCallCountMetricKind } from "@facet/harness-pi/metric-kinds/tool-call-count";
import { toolCallMaxDepthMetricKind } from "@facet/harness-pi/metric-kinds/tool-call-max-depth";
import { toolResultMarkerCountMetricKind } from "@facet/harness-pi/metric-kinds/tool-result-marker-count";
import { createMetricKindRegistry } from "@facet/core/registries/metric-kind-registry.js";
import {
  MetricRuleConfigError,
  runMetricKindsOverEvents,
} from "@facet/core/registries/metric-evaluator.js";
import { defineMetricKind } from "@facet/sdk/metric-kind";

// Bullet 12.6: metric kinds as registered builtins; the
// `runMetricKindsOverEvents(rules, registry, events)` dispatcher walks
// each rule's `consumes` list and folds events into per-rule state.

describe("Bullet 12.6 — metric-kind builtins + consumes dispatcher", () => {
  it("tool_call_count counts only matching toolName events", () => {
    const registry = createMetricKindRegistry();
    registry.register(toolCallCountMetricKind);

    const result = runMetricKindsOverEvents(
      [
        {
          id: "graph_queries",
          kind: "tool_call_count",
          tool_names: ["gitnexus_query", "gitnexus_context"],
        },
      ],
      registry,
      [
        { type: "tool_execution_start", toolName: "gitnexus_query" },
        { type: "tool_execution_start", toolName: "read" },
        { type: "tool_execution_start", toolName: "gitnexus_context" },
        { type: "tool_execution_end", toolName: "gitnexus_query" },
      ] as never,
    );

    expect(result).toEqual({ graph_queries: 2 });
  });

  it("tool_result_marker_count flags one increment per matching event", () => {
    const registry = createMetricKindRegistry();
    registry.register(toolResultMarkerCountMetricKind);

    const result = runMetricKindsOverEvents(
      [
        {
          id: "lens_warnings",
          kind: "tool_result_marker_count",
          applies_to_tools: ["write", "edit"],
          markers: ["WARNING", "CRITICAL"],
        },
      ],
      registry,
      [
        {
          type: "tool_execution_end",
          toolName: "write",
          result: {
            content: [
              { type: "text", text: "all good" },
              { type: "text", text: "WARNING WARNING twice in one event" },
            ],
          },
        },
        {
          type: "tool_execution_end",
          toolName: "write",
          result: { content: [{ type: "text", text: "CRITICAL alert" }] },
        },
        {
          type: "tool_execution_end",
          toolName: "read", // not in applies_to_tools
          result: { content: [{ type: "text", text: "WARNING" }] },
        },
      ] as never,
    );

    expect(result).toEqual({ lens_warnings: 2 });
  });

  it("tool_call_max_depth saturates at 1 when any matching call occurs", () => {
    const registry = createMetricKindRegistry();
    registry.register(toolCallMaxDepthMetricKind);

    const empty = runMetricKindsOverEvents(
      [
        {
          id: "subagent_max_depth",
          kind: "tool_call_max_depth",
          tool_names: ["Agent"],
        },
      ],
      registry,
      [{ type: "tool_execution_start", toolName: "read" }] as never,
    );
    expect(empty).toEqual({ subagent_max_depth: 0 });

    const triggered = runMetricKindsOverEvents(
      [
        {
          id: "subagent_max_depth",
          kind: "tool_call_max_depth",
          tool_names: ["Agent"],
        },
      ],
      registry,
      [
        { type: "tool_execution_start", toolName: "Agent" },
        { type: "tool_execution_start", toolName: "Agent" },
        { type: "tool_execution_start", toolName: "Agent" },
      ] as never,
    );
    expect(triggered).toEqual({ subagent_max_depth: 1 });
  });

  it("dispatcher rejects an unregistered metric kind", () => {
    const registry = createMetricKindRegistry();
    registry.register(toolCallCountMetricKind);

    expect(() =>
      runMetricKindsOverEvents(
        [{ id: "bogus", kind: "ghost_kind", tool_names: ["x"] }],
        registry,
        [],
      ),
    ).toThrow(/No metric-kind handler registered/);
  });

  it("dispatcher rejects malformed configuration with MetricRuleConfigError", () => {
    const registry = createMetricKindRegistry();
    registry.register(toolCallCountMetricKind);

    // tool_names: must be array of non-empty strings, min(1)
    expect(() =>
      runMetricKindsOverEvents(
        [{ id: "bad", kind: "tool_call_count", tool_names: [] }],
        registry,
        [],
      ),
    ).toThrow(MetricRuleConfigError);
  });

  it("dispatches a plugin-declared turn_latency_p95 over turn_end events", () => {
    const registry = createMetricKindRegistry();
    registry.register(
      defineMetricKind({
        id: "turn_latency_p95",
        configSchema: z
          .object({
            field: z.string().min(1),
          })
          .strict(),
        consumes: ["turn_end"],
        initialState: () => [] as number[],
        evaluate: (event, state, _config) => {
          const arr = state as number[];
          const latency = (event as { latencyMs?: number }).latencyMs;
          if (typeof latency === "number") arr.push(latency);
          return arr;
        },
        finalize: (state) => {
          const arr = state as number[];
          if (arr.length === 0) return 0;
          const sorted = arr.slice().sort((a, b) => a - b);
          // Linear-interpolation p95.
          const idx = Math.min(
            sorted.length - 1,
            Math.ceil(sorted.length * 0.95) - 1,
          );
          return sorted[idx]!;
        },
      }),
    );

    // 10 turn_end events with latencies 100..1000ms in increments of 100
    const events = Array.from({ length: 10 }, (_, i) => ({
      type: "turn_end",
      latencyMs: (i + 1) * 100,
    }));

    const result = runMetricKindsOverEvents(
      [{ id: "my_p95", kind: "turn_latency_p95", field: "latencyMs" }],
      registry,
      events as never,
    );

    // p95 of [100..1000]: ceil(10*0.95)=10, so the 10th value (index 9) = 1000.
    expect(result).toEqual({ my_p95: 1000 });
  });
});
