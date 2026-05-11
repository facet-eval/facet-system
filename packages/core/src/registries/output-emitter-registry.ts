import type { OutputEmitterHandler } from "@facet/sdk/output-emitter";

import {
  createTypedRegistry,
  type TypedRegistry,
} from "./common.js";

// ts-prune-ignore-next
export type OutputEmitterRegistry = TypedRegistry<OutputEmitterHandler>;

// ts-prune-ignore-next
export function createOutputEmitterRegistry(): OutputEmitterRegistry {
  return createTypedRegistry<OutputEmitterHandler>("output-emitter");
}
