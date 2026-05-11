import { z } from "zod";

import {
  defineMetricKind,
  type MetricKindHandler,
} from "@facet/sdk/metric-kind";

interface ToolCallCountConfig {
  readonly tool_names: readonly string[];
}

interface ToolStartEvent {
  readonly type: string;
  readonly toolName?: string;
}

// Bullet 12.6 builtin: counts `tool_execution_start` events whose
// `toolName` is in `config.tool_names`. Used by profile-scoped metrics
// like `graph_queries_count`, `rag_queries_count` etc.
// ts-prune-ignore-next
export const toolCallCountMetricKind: MetricKindHandler<ToolCallCountConfig> =
  defineMetricKind({
    id: "tool_call_count",
    configSchema: z
      .object({
        tool_names: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    consumes: ["tool_execution_start"],
    initialState: () => 0,
    evaluate: (event, state, config) => {
      const toolName = (event as ToolStartEvent).toolName;
      if (typeof toolName !== "string" || toolName.length === 0) return state;
      if (!config.tool_names.includes(toolName)) return state;
      return (state as number) + 1;
    },
    finalize: (state) => state as number,
  });
