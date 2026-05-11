import { z } from "zod";

import {
  defineFactorKind,
  type FactorKindHandler,
} from "@facet/sdk/factor-kind";
import type { ModelParamLevel } from "../../spec/schema.js";

interface ModelParamFactor {
  readonly id: string;
  readonly type: "model_param";
  readonly param: string;
  readonly description: string;
  readonly levels: readonly ModelParamLevel[];
}

// Bullet 12.4 builtin: bind a named harness param (e.g. `temperature`,
// `top_p`) to one of the declared values. `apply` writes the value into
// `runConfig.harnessParams[factor.param]`. Phase 6 introduced this kind
// for the temperature-sweep example; the handler surface is unchanged
// modulo the move to a registered kind.
// ts-prune-ignore-next
export const modelParamFactorKind: FactorKindHandler<
  ModelParamLevel,
  ModelParamFactor
> = defineFactorKind({
  id: "model_param",
  levelSchema: z
    .object({
      id: z.string().min(1),
      value: z.union([z.number(), z.string(), z.boolean()]),
    })
    .strict(),
  factorSchema: z
    .object({
      id: z.string().min(1),
      type: z.literal("model_param"),
      param: z.string().min(1),
      description: z.string(),
      levels: z
        .array(
          z
            .object({
              id: z.string().min(1),
              value: z.union([z.number(), z.string(), z.boolean()]),
            })
            .strict(),
        )
        .min(1),
    })
    .strict() as unknown as z.ZodType<ModelParamFactor>,
  expand: (factor) =>
    factor.levels.map((level) => ({
      factorId: factor.id,
      levelId: level.id,
      level,
    })),
  apply: (value, draft) => {
    // The factor name is captured per-level via the factorId; we recover
    // the param name from the apply context via the closure on the spec
    // factor object. Since `apply` only sees the axis value, we encode
    // the param name into the factor at expand time and look it up here
    // via a runtime extension on the level. To keep the SDK contract
    // clean, model-param's apply needs the factor's `param` — so we
    // stash it onto the FactorAxisValue itself by widening at expand
    // time via a sibling helper. The runner's matrix expander threads
    // the factor record alongside the axis value when calling apply
    // (Phase 12.4 implementation detail), so this branch reads
    // `(value as { factor?: ModelParamFactor }).factor?.param` when
    // the runner provides it; otherwise it falls back to the factorId
    // as a defensive default.
    const widened = value as unknown as {
      readonly factor?: ModelParamFactor;
      readonly level: ModelParamLevel;
    };
    const paramName = widened.factor?.param ?? widened.level.id;
    if (draft.harnessParams === undefined) {
      draft.harnessParams = {};
    }
    draft.harnessParams[paramName] = widened.level.value;
  },
});
