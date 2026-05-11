import { z } from "zod";

import { defineTraceEventKind } from "@facet/sdk/trace-event";

// ts-prune-ignore-next
export const turnEndTraceEventKind = defineTraceEventKind({
  id: "turn_end",
  schema: z
    .object({
      type: z.literal("turn_end"),
      timestamp: z.string().min(1),
      tokenUsage: z
        .object({
          input: z.number().optional(),
          output: z.number().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
});
