import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createGitWorktree,
  destroyWorkspace,
  generateWorkspaceId,
  getWorkspaceRoot,
  prepareScenarioRepo,
  WorkspaceError,
} from "@facet/core/workspace/index.js";

async function makeScenario(root: string, name: string): Promise<string> {
  const scenarioPath = path.join(root, name);
  const repoPath = path.join(scenarioPath, "repo");
  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "hello.txt"), "hello world\n", "utf8");
  await writeFile(path.join(repoPath, "package.json"), '{"name":"fixture"}\n', "utf8");
  return scenarioPath;
}

function listWorktrees(repoPath: string): string[] {
  const out = execFileSync("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

describe("workspace", () => {
  let sandbox: string;
  let workspaceRoot: string;
  const created = new Set<string>();

  beforeAll(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), "facet-ws-sandbox-"));
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "facet-ws-root-"));
    process.env.FACET_WORKSPACE_ROOT = workspaceRoot;
  });

  afterAll(async () => {
    delete process.env.FACET_WORKSPACE_ROOT;
    await rm(sandbox, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    for (const workspacePath of created) {
      await destroyWorkspace(workspacePath).catch(() => undefined);
    }
    created.clear();
  });

  it("prepareScenarioRepo initializes a git repo and is idempotent", async () => {
    const scenario = await makeScenario(sandbox, "scenario-init");
    const repoPath = await prepareScenarioRepo(scenario);
    expect(repoPath).toBe(path.join(scenario, "repo"));
    expect(existsSync(path.join(repoPath, ".git"))).toBe(true);

    const log = execFileSync("git", ["-C", repoPath, "log", "--oneline"], { encoding: "utf8" });
    expect(log.trim().split("\n").length).toBe(1);

    const again = await prepareScenarioRepo(scenario);
    expect(again).toBe(repoPath);
    const logAgain = execFileSync("git", ["-C", repoPath, "log", "--oneline"], { encoding: "utf8" });
    expect(logAgain).toBe(log);
  });

  it("prepareScenarioRepo rejects a missing repo/ directory", async () => {
    const missing = path.join(sandbox, "does-not-exist");
    await expect(prepareScenarioRepo(missing)).rejects.toBeInstanceOf(WorkspaceError);
  });

  it("createGitWorktree produces an isolated copy of the scenario repo", async () => {
    const scenario = await makeScenario(sandbox, "scenario-create");
    const repoPath = await prepareScenarioRepo(scenario);
    const id = generateWorkspaceId();
    const workspacePath = await createGitWorktree(repoPath, id);
    created.add(workspacePath);

    expect(workspacePath).toBe(path.join(getWorkspaceRoot(), id));
    expect(existsSync(workspacePath)).toBe(true);
    expect(await readFile(path.join(workspacePath, "hello.txt"), "utf8")).toBe("hello world\n");
  });

  it("modifying files in the workspace does not affect the scenario repo", async () => {
    const scenario = await makeScenario(sandbox, "scenario-isolation");
    const repoPath = await prepareScenarioRepo(scenario);
    const id = generateWorkspaceId();
    const workspacePath = await createGitWorktree(repoPath, id);
    created.add(workspacePath);

    await writeFile(path.join(workspacePath, "hello.txt"), "mutated\n", "utf8");
    await writeFile(path.join(workspacePath, "new-file.txt"), "new\n", "utf8");

    expect(await readFile(path.join(repoPath, "hello.txt"), "utf8")).toBe("hello world\n");
    expect(existsSync(path.join(repoPath, "new-file.txt"))).toBe(false);
  });

  it("destroyWorkspace removes the directory and the git worktree entry", async () => {
    const scenario = await makeScenario(sandbox, "scenario-destroy");
    const repoPath = await prepareScenarioRepo(scenario);
    const id = generateWorkspaceId();
    const workspacePath = await createGitWorktree(repoPath, id);

    const canonical = realpathSync(workspacePath);
    expect(listWorktrees(repoPath)).toContain(canonical);

    await destroyWorkspace(workspacePath);

    expect(existsSync(workspacePath)).toBe(false);
    expect(listWorktrees(repoPath)).not.toContain(canonical);
  });

  it("supports creating three workspaces concurrently over the same scenario", async () => {
    const scenario = await makeScenario(sandbox, "scenario-concurrent");
    const repoPath = await prepareScenarioRepo(scenario);

    const ids = [generateWorkspaceId(), generateWorkspaceId(), generateWorkspaceId()];
    const paths = await Promise.all(ids.map((id) => createGitWorktree(repoPath, id)));
    for (const p of paths) created.add(p);

    expect(new Set(paths).size).toBe(3);
    for (const p of paths) {
      expect(existsSync(path.join(p, "hello.txt"))).toBe(true);
    }
    const registered = listWorktrees(repoPath);
    for (const p of paths) {
      expect(registered).toContain(realpathSync(p));
    }
  });
});
