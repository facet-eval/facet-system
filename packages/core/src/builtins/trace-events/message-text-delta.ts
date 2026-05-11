import { z } from "zod";

import { defineTraceEventKind } from "@facet/sdk/trace-event";

// ts-prune-ignore-next
export const messageTextDeltaTraceEventKind = defineTraceEventKind({
  id: "message_text_delta",
  schema: z
    .object({
      type: z.literal("message_text_delta"),
      timestamp: z.string().min(1),
      text: z.string().optional(),
    })
    .strict(),
});
