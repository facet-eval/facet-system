import { z } from "zod";

import {
  defineFactorKind,
  type FactorKindHandler,
} from "@facet/sdk/factor-kind";
import type { PromptLevel } from "../../spec/schema.js";

interface PromptSwapFactor {
  readonly id: string;
  readonly type: "prompt_swap";
  readonly description: string;
  readonly levels: readonly PromptLevel[];
}

// Bullet 12.4 builtin: vary the prompt id picked from the scenario's
// `prompts:` block. `apply` writes the level's id to `runConfig.promptId`;
// the runner uses that id to look up the actual prompt path.
// ts-prune-ignore-next
export const promptSwapFactorKind: FactorKindHandler<PromptLevel, PromptSwapFactor> =
  defineFactorKind({
    id: "prompt_swap",
    levelSchema: z.object({ id: z.string().min(1) }).strict(),
    expand: (factor) =>
      factor.levels.map((level) => ({
        factorId: factor.id,
        levelId: level.id,
        level,
      })),
    apply: (value, draft) => {
      draft.promptId = value.level.id;
    },
  });
