import { z } from "zod";

import {
  defineFactorKind,
  type FactorKindHandler,
} from "@facet/sdk/factor-kind";
import type { ModelLevel } from "../../spec/schema.js";

interface ModelSwapFactor {
  readonly id: string;
  readonly type: "model_swap";
  readonly description: string;
  readonly levels: readonly ModelLevel[];
}

// Bullet 12.4 builtin: vary the (provider, model_id) pair the harness
// uses for the run. `apply` writes the level id, provider, and the
// internal model_id so the runner can pass them to `harness.runSession`.
// ts-prune-ignore-next
export const modelSwapFactorKind: FactorKindHandler<ModelLevel, ModelSwapFactor> =
  defineFactorKind({
    id: "model_swap",
    levelSchema: z
      .object({
        id: z.string().min(1),
        provider: z.string().min(1),
        model_id: z.string().min(1),
      })
      .strict(),
    expand: (factor) =>
      factor.levels.map((level) => ({
        factorId: factor.id,
        levelId: level.id,
        level,
      })),
    apply: (value, draft) => {
      draft.modelLevelId = value.level.id;
      draft.provider = value.level.provider;
      draft.modelInternalId = value.level.model_id;
    },
  });
