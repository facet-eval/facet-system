// @facet/sdk — workspace-strategy.ts
//
// Public contract for workspace strategies — the discriminator that
// drives `environment.workspace_strategy` in a spec. The framework
// builtin is `git_worktree` (creates an isolated worktree per run with
// a short-lived branch). Plugins could add `in_memory` for fast tests,
// `docker_volume` for stronger isolation, or harness-specific shapes.

import type { ZodType } from "zod";

// Lifecycle handle returned by `prepare`. The runner calls `cleanup`
// after the run completes (success or failure) — strategies are
// responsible for being idempotent under crash + retry.
// ts-prune-ignore-next
export interface WorkspaceHandle {
  readonly path: string;
  cleanup(): Promise<void>;
}

// ts-prune-ignore-next
export interface WorkspacePrepareInput {
  readonly scenarioPath: string;
  readonly scenarioId: string;
  readonly codeDir: string;
  readonly runId: string;
  readonly bundlePath: string;
}

// ts-prune-ignore-next
export interface WorkspaceStrategyHandler<TConfig = undefined> {
  // Discriminator value, e.g. "git_worktree". Must be unique within the
  // active registry.
  readonly id: string;
  // Optional schema for strategy-specific configuration. Today no
  // builtin strategy reads anything beyond the universal input;
  // plugins that need configuration declare it here and the spec
  // parser embeds it under `environment.workspace_strategy_config`
  // (introduced when the first plugin needs it).
  readonly configSchema?: ZodType<TConfig>;
  prepare(
    input: WorkspacePrepareInput,
    config: TConfig,
  ): Promise<WorkspaceHandle>;
}

// ts-prune-ignore-next
export function defineWorkspaceStrategy<TConfig>(
  handler: WorkspaceStrategyHandler<TConfig>,
): WorkspaceStrategyHandler<TConfig> {
  return handler;
}
