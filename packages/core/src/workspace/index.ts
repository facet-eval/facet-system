import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { mkdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { simpleGit, type SimpleGit } from "simple-git";

export class WorkspaceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WorkspaceError";
  }
}

const DEFAULT_WORKSPACE_ROOT = join(tmpdir(), "facet");
const BRANCH_PREFIX = "facet/";

// Phase 8 / Bullet 8.3. Default name of the in-scenario subdirectory
// that becomes the per-run git repo. Overridable via `meta.yaml.code_dir`.
export const DEFAULT_SCENARIO_CODE_DIR = "repo";

// Phase 8 / Bullet 8.5 — F-41. Defensive denylist applied to any
// scenario-relative path supplied by the user (today: `meta.yaml.code_dir`).
// `reference_solution/` is the canonical sibling holding the cheat-sheet
// fixtures used by oracle scripts; copying it into the agent's working
// repo would leak the answer. Extend with care.
export const SCENARIO_PATH_DENYLIST: readonly string[] = ["reference_solution"];

interface WorkspaceRecord {
  repoPath: string;
  branch: string;
}

const activeWorkspaces = new Map<string, WorkspaceRecord>();
const repoQueues = new Map<string, Promise<void>>();
let cleanupRegistered = false;

async function withRepoLock<T>(repoPath: string, task: () => Promise<T>): Promise<T> {
  const key = resolve(repoPath);
  const previous = repoQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const slot = new Promise<void>((resolveSlot) => {
    release = resolveSlot;
  });
  const chained = previous.then(() => slot);
  repoQueues.set(key, chained);
  try {
    await previous;
  } catch {
    // Only serialization matters; ignore prior failures.
  }
  try {
    return await task();
  } finally {
    release();
    if (repoQueues.get(key) === chained) {
      repoQueues.delete(key);
    }
  }
}

export function generateWorkspaceId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function getWorkspaceRoot(): string {
  const override = process.env.FACET_WORKSPACE_ROOT;
  return override && override.length > 0 ? override : DEFAULT_WORKSPACE_ROOT;
}

export async function prepareScenarioRepo(
  scenarioPath: string,
  codeDir: string = DEFAULT_SCENARIO_CODE_DIR,
): Promise<string> {
  // Phase 8 / Bullet 8.5 — refuse to treat a denylisted subdirectory as
  // the per-run repo. Catches the case where a scenario author mistakenly
  // points `code_dir` at `reference_solution`.
  if (SCENARIO_PATH_DENYLIST.includes(codeDir)) {
    throw new WorkspaceError(
      `code_dir "${codeDir}" is on SCENARIO_PATH_DENYLIST and cannot be used as the per-run repo`,
    );
  }
  const repoPath = resolve(scenarioPath, codeDir);
  try {
    const stats = await stat(repoPath);
    if (!stats.isDirectory()) {
      throw new WorkspaceError(`Scenario repo path is not a directory: ${repoPath}`);
    }
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new WorkspaceError(`Scenario repo directory not found: ${repoPath}`);
    }
    throw error;
  }

  const git = simpleGit(repoPath);
  const alreadyRepo = await git.checkIsRepo().catch(() => false);
  if (alreadyRepo) {
    // simple-git's checkIsRepo returns true even when repoPath is merely nested
    // inside a parent git repository. Verify the toplevel is repoPath itself;
    // otherwise init a dedicated repo so worktrees are scoped to scenario files.
    const topLevelRaw = await git
      .revparse(["--show-toplevel"])
      .catch(() => "");
    const topLevel = topLevelRaw.trim();
    if (topLevel.length > 0) {
      const canonicalTop = await realpath(topLevel).catch(() => topLevel);
      const canonicalRepo = await realpath(repoPath).catch(() => repoPath);
      if (canonicalTop === canonicalRepo) {
        return repoPath;
      }
    }
  }

  try {
    await git.init();
    await git.addConfig("user.email", "scenario@facet.local", false, "local");
    await git.addConfig("user.name", "facet scenario", false, "local");
    await git.add(".");
    await git.commit("initial scenario state", undefined, { "--allow-empty": null });
  } catch (error) {
    throw new WorkspaceError(
      `Failed to initialize git repo at ${repoPath}: ${(error as Error).message}`,
      { cause: error },
    );
  }
  return repoPath;
}

// Bullet 16.1 — the legacy `prepareWorkspace(strategy, …)` dispatcher
// was removed in favor of the workspace-strategy registry. The runner
// now resolves the handler from `workspace-strategy-registry` and
// calls its `prepare(input, config)` method, which owns both
// `prepareScenarioRepo` and `createGitWorktree`. Plugins ship new
// strategies (in_memory, docker_volume) by registering a handler from
// their `register(registries)` hook.

export async function createGitWorktree(
  scenarioRepoPath: string,
  workspaceId: string,
): Promise<string> {
  if (!workspaceId || workspaceId.includes("/") || workspaceId.includes("..")) {
    throw new WorkspaceError(`Invalid workspaceId: ${JSON.stringify(workspaceId)}`);
  }
  registerCleanup();
  const root = getWorkspaceRoot();
  await mkdir(root, { recursive: true });
  const workspacePath = join(root, workspaceId);
  if (existsSync(workspacePath)) {
    throw new WorkspaceError(`Workspace path already exists: ${workspacePath}`);
  }
  const branch = `${BRANCH_PREFIX}${workspaceId}`;
  const git: SimpleGit = simpleGit(scenarioRepoPath);
  await withRepoLock(scenarioRepoPath, async () => {
    try {
      await git.raw(["worktree", "add", "-b", branch, workspacePath, "HEAD"]);
    } catch (error) {
      throw new WorkspaceError(
        `Failed to create git worktree at ${workspacePath}: ${(error as Error).message}`,
        { cause: error },
      );
    }
  });
  activeWorkspaces.set(workspacePath, { repoPath: scenarioRepoPath, branch });
  return workspacePath;
}

export async function destroyWorkspace(workspacePath: string): Promise<void> {
  const record = activeWorkspaces.get(workspacePath);
  if (record) {
    const git = simpleGit(record.repoPath);
    await withRepoLock(record.repoPath, async () => {
      await git.raw(["worktree", "remove", "--force", workspacePath]).catch(() => undefined);
      await git.raw(["branch", "-D", record.branch]).catch(() => undefined);
    });
  }
  if (existsSync(workspacePath)) {
    await rm(workspacePath, { recursive: true, force: true });
  }
  activeWorkspaces.delete(workspacePath);
}

function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const cleanup = (): void => {
    for (const [workspacePath, record] of activeWorkspaces) {
      try {
        execFileSync(
          "git",
          ["-C", record.repoPath, "worktree", "remove", "--force", workspacePath],
          { stdio: "ignore" },
        );
      } catch {
        // best effort — worktree may already be gone
      }
      try {
        execFileSync(
          "git",
          ["-C", record.repoPath, "branch", "-D", record.branch],
          { stdio: "ignore" },
        );
      } catch {
        // best effort — branch may already be gone
      }
      try {
        rmSync(workspacePath, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    activeWorkspaces.clear();
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
}
