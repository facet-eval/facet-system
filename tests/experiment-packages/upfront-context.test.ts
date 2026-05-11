import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ExtensionsManifest, UpfrontContextItem } from "@facet/core/runner/extensions.js";
import {
  prepareUpfrontContext,
  UpfrontContextError,
  type UpfrontContextRun,
} from "@facet/core/runner/upfront-context.js";

interface RecordedCall {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}

function fakeRunner(
  scripted: ReadonlyMap<
    string,
    { stdout?: string; stderr?: string; code?: number | null }
  >,
): { run: UpfrontContextRun; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const run: UpfrontContextRun = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd, timeoutMs: opts.timeoutMs });
    const scriptedResult = scripted.get(cmd);
    return {
      stdout: scriptedResult?.stdout ?? "",
      stderr: scriptedResult?.stderr ?? "",
      code: scriptedResult?.code ?? 0,
    };
  };
  return { run, calls };
}

function manifestWith(
  upfrontContext: readonly UpfrontContextItem[],
): ExtensionsManifest {
  return {
    extensions: [],
    upfrontContext,
    requiresBinaries: [],
    requiresBinariesPerScenario: {},
    languageServers: {},
    metricRules: [],
    toolOwners: {},
    pinnedAgents: undefined,
  };
}

const SAMPLE_ITEM: UpfrontContextItem = {
  appliesToScenarios: ["compound-haskell"],
  command: "bash",
  args: ["upfront/haskell.sh", "${WORKSPACE}"],
  cwd: "${WORKSPACE}",
  timeoutMs: 60_000,
  header: "## Workspace structural context (synthetic)",
};

describe("prepareUpfrontContext (Bullet 5.1, generic exec wrapper)", () => {
  let workspacePath: string;
  let profilePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(os.tmpdir(), "facet-upfront-ws-"));
    profilePath = await mkdtemp(path.join(os.tmpdir(), "facet-upfront-prof-"));
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
    await rm(profilePath, { recursive: true, force: true });
  });

  it("returns undefined when no upfront_context items match the scenario", async () => {
    const result = await prepareUpfrontContext({
      extensions: manifestWith([SAMPLE_ITEM]),
      profilePath,
      scenarioId: "compound-c",
      workspacePath,
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when extensions has no upfront_context", async () => {
    const result = await prepareUpfrontContext({
      extensions: manifestWith([]),
      profilePath,
      scenarioId: "compound-haskell",
      workspacePath,
    });
    expect(result).toBeUndefined();
  });

  it("substitutes ${WORKSPACE} in cwd and args, then renders header + stdout", async () => {
    const { run, calls } = fakeRunner(
      new Map([["bash", { code: 0, stdout: "Module dependency graph:\n```\nA -> B\n```\n" }]]),
    );

    const out = await prepareUpfrontContext({
      extensions: manifestWith([SAMPLE_ITEM]),
      profilePath,
      scenarioId: "compound-haskell",
      workspacePath,
      run,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe("bash");
    expect(calls[0]!.args).toEqual(["upfront/haskell.sh", workspacePath]);
    expect(calls[0]!.cwd).toBe(workspacePath);
    expect(calls[0]!.timeoutMs).toBe(60_000);

    expect(out).toBe(
      "## Workspace structural context (synthetic)\n\nModule dependency graph:\n```\nA -> B\n```",
    );
  });

  it("resolves a relative cwd against the profile dir", async () => {
    const item: UpfrontContextItem = { ...SAMPLE_ITEM, cwd: "subdir" };
    const { run, calls } = fakeRunner(new Map([["bash", { code: 0, stdout: "ok\n" }]]));

    await prepareUpfrontContext({
      extensions: manifestWith([item]),
      profilePath,
      scenarioId: "compound-haskell",
      workspacePath,
      run,
    });
    expect(calls[0]!.cwd).toBe(path.join(profilePath, "subdir"));
  });

  it("throws UpfrontContextError when the command exits non-zero", async () => {
    const { run } = fakeRunner(
      new Map([["bash", { code: 2, stdout: "", stderr: "boom" }]]),
    );

    await expect(
      prepareUpfrontContext({
        extensions: manifestWith([SAMPLE_ITEM]),
        profilePath,
        scenarioId: "compound-haskell",
        workspacePath,
        run,
      }),
    ).rejects.toBeInstanceOf(UpfrontContextError);
  });

  it("joins multiple matching items with two newlines between blocks", async () => {
    const item2: UpfrontContextItem = {
      ...SAMPLE_ITEM,
      command: "echo",
      args: ["second"],
      header: "## Second block",
    };
    const { run } = fakeRunner(
      new Map([
        ["bash", { code: 0, stdout: "first" }],
        ["echo", { code: 0, stdout: "second" }],
      ]),
    );
    const out = await prepareUpfrontContext({
      extensions: manifestWith([SAMPLE_ITEM, item2]),
      profilePath,
      scenarioId: "compound-haskell",
      workspacePath,
      run,
    });
    expect(out).toBe(
      "## Workspace structural context (synthetic)\n\nfirst\n\n## Second block\n\nsecond",
    );
  });
});
