import { z } from "zod";

import { defineTraceEventKind } from "@facet/sdk/trace-event";

// ts-prune-ignore-next
export const agentStartTraceEventKind = defineTraceEventKind({
  id: "agent_start",
  schema: z
    .object({
      type: z.literal("agent_start"),
      timestamp: z.string().min(1),
    })
    .strict(),
});
