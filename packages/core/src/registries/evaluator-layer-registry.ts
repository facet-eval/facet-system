import type { EvaluatorLayerHandler } from "@facet/sdk/evaluator-layer";

import {
  createTypedRegistry,
  type TypedRegistry,
} from "./common.js";

// ts-prune-ignore-next
export type EvaluatorLayerRegistry = TypedRegistry<EvaluatorLayerHandler>;

// ts-prune-ignore-next
export function createEvaluatorLayerRegistry(): EvaluatorLayerRegistry {
  return createTypedRegistry<EvaluatorLayerHandler>("evaluator-layer");
}
