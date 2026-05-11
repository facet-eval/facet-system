import { z } from "zod";

import { defineTraceEventKind } from "@facet/sdk/trace-event";

// ts-prune-ignore-next
export const toolExecutionEndTraceEventKind = defineTraceEventKind({
  id: "tool_execution_end",
  schema: z
    .object({
      type: z.literal("tool_execution_end"),
      timestamp: z.string().min(1),
      toolCallId: z.string().optional(),
      toolName: z.string().optional(),
      result: z
        .object({
          content: z
            .array(
              z
                .object({
                  type: z.string().optional(),
                  text: z.string().optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .strict()
        .optional(),
      isError: z.boolean().optional(),
    })
    .strict(),
});
