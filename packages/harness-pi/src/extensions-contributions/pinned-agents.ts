// Bullet 16.2 — Pi-specific `pinned_agents` sub-block of
// `extensions.yaml`. Moved out of core's `runner/extensions.ts` so the
// strings `pinned_agents` / `source_dir` / `model_placeholder` no
// longer appear in framework source.
//
// The harness adapter wires this into `HarnessRunConfig.extras.agentDir`
// (the runner-side `prepareAgentPin` pre-session hook copies the .md
// files into a per-run agent dir before each Pi session starts; that
// logic still lives in core today but is invariant under this move
// because it reads from the typed `manifest.pinnedAgents` convenience
// field that the registry-driven loader populates).

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  defineExtensionsContribution,
  type ExtensionsContributionIssue,
} from "@facet/sdk/extensions-yaml";

// Bullet 16.2 — pre-16.2 the legacy in-core schema used `.default()` on
// each field; the .default() variant has an input/output type
// asymmetry that does not satisfy the SDK's `ZodType<TValue>`
// constraint. Required-fields-with-conventional-values is simpler and
// matches every shipped preset (every consumer declares all three
// fields explicitly).
export const PinnedAgentsValueSchema = z
  .object({
    source_dir: z.string().min(1),
    model_placeholder: z.string().min(1),
    inherit_user_models_json: z.boolean(),
  })
  .strict();

export type PinnedAgentsValue = z.infer<typeof PinnedAgentsValueSchema>;

function isDirectory(absPath: string): boolean {
  try {
    return existsSync(absPath) && readdirSync(absPath) !== undefined;
  } catch {
    return false;
  }
}

export const pinnedAgentsContribution = defineExtensionsContribution<PinnedAgentsValue>({
  key: "pinned_agents",
  schema: PinnedAgentsValueSchema,
  preflight(value, { profilePath, profileId }) {
    // Mirror of the legacy validator preflight that used to live in
    // `packages/core/src/validator/index.ts` (the `pinned-agents-empty`
    // code) before bullet 16.2 hoisted it here.
    const sourceDirAbs = path.resolve(profilePath, value.source_dir);
    if (!isDirectory(sourceDirAbs)) {
      return [
        {
          code: "pinned-agents-empty",
          message: `Profile "${profileId}" pinned_agents.source_dir does not exist: ${value.source_dir}`,
          path: sourceDirAbs,
        },
      ];
    }
    const mds = readdirSync(sourceDirAbs).filter((n) => n.endsWith(".md"));
    if (mds.length === 0) {
      return [
        {
          code: "pinned-agents-empty",
          message: `Profile "${profileId}" pinned_agents.source_dir contains no *.md files: ${value.source_dir}`,
          path: sourceDirAbs,
        },
      ];
    }
    return [];
  },
});
