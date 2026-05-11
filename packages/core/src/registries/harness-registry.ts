import type { HarnessAdapter } from "@facet/sdk/harness";

import {
  createTypedRegistry,
  type TypedRegistry,
} from "./common.js";

// ts-prune-ignore-next
export type HarnessRegistry = TypedRegistry<HarnessAdapter>;

// ts-prune-ignore-next
export function createHarnessRegistry(): HarnessRegistry {
  return createTypedRegistry<HarnessAdapter>("harness");
}
