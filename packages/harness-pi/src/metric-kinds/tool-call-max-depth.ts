import { z } from "zod";

import {
  defineMetricKind,
  type MetricKindHandler,
} from "@facet/sdk/metric-kind";

interface ToolCallMaxDepthConfig {
  readonly tool_names: readonly string[];
}

interface ToolStartEvent {
  readonly type: string;
  readonly toolName?: string;
}

// Bullet 12.6 builtin: max-depth projection of the named tool calls.
// Today's traces don't nest sub-agent calls in the parent's stream, so
// the value is 1 when any matching call occurs and 0 otherwise. A future
// trace-shape change (proper depth tracking) unlocks real values
// without changing the kind contract.
// ts-prune-ignore-next
export const toolCallMaxDepthMetricKind: MetricKindHandler<ToolCallMaxDepthConfig> =
  defineMetricKind({
    id: "tool_call_max_depth",
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
      return Math.max(state as number, 1);
    },
    finalize: (state) => state as number,
  });
