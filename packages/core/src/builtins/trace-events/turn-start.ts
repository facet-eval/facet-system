import { z } from "zod";

import { defineTraceEventKind } from "@facet/sdk/trace-event";

// ts-prune-ignore-next
export const turnStartTraceEventKind = defineTraceEventKind({
  id: "turn_start",
  schema: z
    .object({
      type: z.literal("turn_start"),
      timestamp: z.string().min(1),
    })
    .strict(),
});
