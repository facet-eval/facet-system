import type { MetricKindHandler } from "@facet/sdk/metric-kind";

import {
  createTypedRegistry,
  type TypedRegistry,
} from "./common.js";

// ts-prune-ignore-next
export type MetricKindRegistry = TypedRegistry<MetricKindHandler>;

// ts-prune-ignore-next
export function createMetricKindRegistry(): MetricKindRegistry {
  return createTypedRegistry<MetricKindHandler>("metric-kind");
}
