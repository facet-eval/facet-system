import { z } from "zod";

import {
  defineMetricKind,
  type MetricKindHandler,
} from "@facet/sdk/metric-kind";

interface ToolResultMarkerCountConfig {
  readonly applies_to_tools: readonly string[];
  readonly markers: readonly string[];
}

interface ToolEndEvent {
  readonly type: string;
  readonly toolName?: string;
  readonly result?: {
    readonly content?: ReadonlyArray<{
      readonly type?: string;
      readonly text?: string;
    }>;
  };
}

// Bullet 12.6 builtin: increments once per `tool_execution_end` whose
// `result.content[].text` contains any of `config.markers`, gated by
// `toolName ∈ config.applies_to_tools`. One increment per matching
// event, regardless of how many marker matches it contains — preserves
// the pi-lens "warning messages, not individual items" semantic.
// ts-prune-ignore-next
export const toolResultMarkerCountMetricKind: MetricKindHandler<ToolResultMarkerCountConfig> =
  defineMetricKind({
    id: "tool_result_marker_count",
    configSchema: z
      .object({
        applies_to_tools: z.array(z.string().min(1)).min(1),
        markers: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    consumes: ["tool_execution_end"],
    initialState: () => 0,
    evaluate: (event, state, config) => {
      const toolEnd = event as ToolEndEvent;
      const toolName = toolEnd.toolName;
      if (typeof toolName !== "string" || toolName.length === 0) return state;
      if (!config.applies_to_tools.includes(toolName)) return state;
      const items = toolEnd.result?.content;
      if (items === undefined) return state;
      for (const item of items) {
        if (item.type !== "text" || typeof item.text !== "string") continue;
        for (const marker of config.markers) {
          if (item.text.includes(marker)) {
            return (state as number) + 1;
          }
        }
      }
      return state;
    },
    finalize: (state) => state as number,
  });
