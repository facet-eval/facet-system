import { z } from "zod";

import { defineTraceEventKind } from "@facet/sdk/trace-event";

// ts-prune-ignore-next
export const toolExecutionStartTraceEventKind = defineTraceEventKind({
  id: "tool_execution_start",
  schema: z
    .object({
      type: z.literal("tool_execution_start"),
      timestamp: z.string().min(1),
      toolCallId: z.string().optional(),
      toolName: z.string().optional(),
      args: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
});
