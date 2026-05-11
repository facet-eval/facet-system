import { z } from "zod";

import {
  defineWorkspaceStrategy,
  type WorkspaceStrategyHandler,
} from "@facet/sdk/workspace-strategy";
import {
  createGitWorktree,
  destroyWorkspace,
  generateWorkspaceId,
  prepareScenarioRepo,
} from "../../workspace/index.js";

// Bullet 12.7 builtin: SDK adapter for the only production workspace
// strategy. Wraps `prepareScenarioRepo` + `createGitWorktree` and
// returns a handle whose `cleanup()` calls `destroyWorkspace`. The
// legacy `prepareWorkspace(strategy, …)` dispatcher in
// `src/workspace/index.ts` keeps the production runner working
// unchanged; Phase 13+ flips it to the registry-driven path.
// ts-prune-ignore-next
export const gitWorktreeWorkspaceStrategy: WorkspaceStrategyHandler<undefined> =
  defineWorkspaceStrategy({
    id: "git_worktree",
    configSchema: z.undefined(),
    async prepare(input) {
      const repoPath = await prepareScenarioRepo(
        input.scenarioPath,
        input.codeDir,
      );
      const workspaceId = generateWorkspaceId();
      const path = await createGitWorktree(repoPath, workspaceId);
      return {
        path,
        async cleanup() {
          await destroyWorkspace(path);
        },
      };
    },
  });
