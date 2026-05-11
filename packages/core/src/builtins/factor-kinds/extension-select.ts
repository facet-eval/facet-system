import { z } from "zod";

import {
  defineFactorKind,
  type FactorKindHandler,
} from "@facet/sdk/factor-kind";
import type { ProfileLevel } from "../../spec/schema.js";

interface ExtensionSelectFactor {
  readonly id: string;
  readonly type: "extension_select";
  readonly description: string;
  readonly levels: readonly ProfileLevel[];
}

// Bullet 12.4 builtin: pick the profile (= bundle of system prompt +
// tools.yaml + extensions.yaml + …) for the run. `apply` writes the
// level's id, ref, and hash so the runner can resolve the profile
// directory and record the resolved hash in the manifest.
// ts-prune-ignore-next
export const extensionSelectFactorKind: FactorKindHandler<
  ProfileLevel,
  ExtensionSelectFactor
> = defineFactorKind({
  id: "extension_select",
  levelSchema: z
    .object({
      id: z.string().min(1),
      ref: z.string().min(1),
      hash: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  expand: (factor) =>
    factor.levels.map((level) => ({
      factorId: factor.id,
      levelId: level.id,
      level,
    })),
  apply: (value, draft) => {
    draft.profileId = value.level.id;
    draft.profileRef = value.level.ref;
    draft.profileHash = value.level.hash;
  },
});
