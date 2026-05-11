import type { FactorKindHandler } from "@facet/sdk/factor-kind";

import {
  createTypedRegistry,
  type TypedRegistry,
} from "./common.js";

// ts-prune-ignore-next
export type FactorKindRegistry = TypedRegistry<FactorKindHandler>;

// ts-prune-ignore-next
export function createFactorKindRegistry(): FactorKindRegistry {
  return createTypedRegistry<FactorKindHandler>("factor-kind");
}
