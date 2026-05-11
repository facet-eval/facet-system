import type { TraceEventKind } from "@facet/sdk/trace-event";

import {
  createTypedRegistry,
  type TypedRegistry,
} from "./common.js";

// ts-prune-ignore-next
export type TraceEventRegistry = TypedRegistry<TraceEventKind>;

// ts-prune-ignore-next
export function createTraceEventRegistry(): TraceEventRegistry {
  return createTypedRegistry<TraceEventKind>("trace-event");
}
