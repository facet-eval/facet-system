import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { prepareAgentPin, AgentPinError } from "@facet/core/runner/agent-pin.js";
import type {
  ExtensionsManifest,
  PinnedAgentsConfig,
} from "@facet/core/runner/extensions.js";

function manifestWith(
  pinnedAgents: PinnedAgentsConfig | undefined,
): ExtensionsManifest {
  return {
    extensions: [],
    upfrontContext: [],
    requiresBinaries: [],
    requiresBinariesPerScenario: {},
    languageServers: {},
    metricRules: [],
    toolOwners: {},
    pinnedAgents,
  };
}

describe("prepareAgentPin (Bullet 5.2, generic .md copier)", () => {
  let profilePath: string;
  let runDir: string;

  beforeEach(async () => {
    profilePath = await mkdtemp(path.join(os.tmpdir(), "facet-agent-prof-"));
    runDir = await mkdtemp(path.join(os.tmpdir(), "facet-agent-run-"));
  });

  afterEach(async () => {
    await rm(profilePath, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  });

  it("returns undefined when extensions does not declare pinned_agents", async () => {
    const result = await prepareAgentPin({
      extensions: manifestWith(undefined),
      profilePath,
      provider: "openrouter",
      modelId: "test-model",
      runDir,
    });
    expect(result).toBeUndefined();
  });

  it("copies every .md file under source_dir, substituting ${RUN_MODEL}", async () => {
    const sourceDir = path.join(profilePath, "agents");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      path.join(sourceDir, "general-purpose.md"),
      "---\nmodel: ${RUN_MODEL}\n---\nbody\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "Explore.md"),
      "---\nmodel: ${RUN_MODEL}\ntools: read\n---\nexplore body\n",
      "utf8",
    );

    const result = await prepareAgentPin({
      extensions: manifestWith({
        sourceDir: "agents",
        modelPlaceholder: "${RUN_MODEL}",
        inheritUserModelsJson: false,
      }),
      profilePath,
      provider: "openrouter",
      modelId: "qwen/qwen3.6-27b",
      runDir,
    });

    expect(result).toBeDefined();
    const agentsOut = path.join(result!.agentDir, "agents");
    const generalText = await readFile(path.join(agentsOut, "general-purpose.md"), "utf8");
    expect(generalText).toContain("model: openrouter/qwen/qwen3.6-27b");
    expect(generalText).not.toContain("${RUN_MODEL}");
    const exploreText = await readFile(path.join(agentsOut, "Explore.md"), "utf8");
    expect(exploreText).toContain("model: openrouter/qwen/qwen3.6-27b");
    expect(exploreText).toContain("tools: read");

    await result!.cleanup();
  });

  it("respects a custom model_placeholder", async () => {
    const sourceDir = path.join(profilePath, "agents");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      path.join(sourceDir, "a.md"),
      "model: <<MODEL>>\n",
      "utf8",
    );

    const result = await prepareAgentPin({
      extensions: manifestWith({
        sourceDir: "agents",
        modelPlaceholder: "<<MODEL>>",
        inheritUserModelsJson: false,
      }),
      profilePath,
      provider: "anthropic",
      modelId: "claude-test",
      runDir,
    });

    const text = await readFile(path.join(result!.agentDir, "agents", "a.md"), "utf8");
    expect(text).toBe("model: anthropic/claude-test\n");
    await result!.cleanup();
  });

  it("inherits the user's models.json when inherit_user_models_json is true", async () => {
    const sourceDir = path.join(profilePath, "agents");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, "a.md"), "x", "utf8");

    const userHome = await mkdtemp(path.join(os.tmpdir(), "facet-userhome-"));
    const userModelsJson = path.join(userHome, "models.json");
    await writeFile(userModelsJson, '{"custom":"entry"}', "utf8");

    try {
      const result = await prepareAgentPin({
        extensions: manifestWith({
          sourceDir: "agents",
          modelPlaceholder: "${RUN_MODEL}",
          inheritUserModelsJson: true,
        }),
        profilePath,
        provider: "openrouter",
        modelId: "test-model",
        runDir,
        userModelsJsonPath: userModelsJson,
      });

      const copied = await readFile(path.join(result!.agentDir, "models.json"), "utf8");
      expect(copied).toBe('{"custom":"entry"}');
      await result!.cleanup();
    } finally {
      await rm(userHome, { recursive: true, force: true });
    }
  });

  it("does NOT copy models.json when inherit_user_models_json is false", async () => {
    const sourceDir = path.join(profilePath, "agents");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, "a.md"), "x", "utf8");
    const userHome = await mkdtemp(path.join(os.tmpdir(), "facet-userhome-"));
    const userModelsJson = path.join(userHome, "models.json");
    await writeFile(userModelsJson, '{"x":1}', "utf8");

    try {
      const result = await prepareAgentPin({
        extensions: manifestWith({
          sourceDir: "agents",
          modelPlaceholder: "${RUN_MODEL}",
          inheritUserModelsJson: false,
        }),
        profilePath,
        provider: "openrouter",
        modelId: "test-model",
        runDir,
        userModelsJsonPath: userModelsJson,
      });

      const expectedPath = path.join(result!.agentDir, "models.json");
      const { existsSync } = await import("node:fs");
      expect(existsSync(expectedPath)).toBe(false);
      await result!.cleanup();
    } finally {
      await rm(userHome, { recursive: true, force: true });
    }
  });

  it("throws AgentPinError when source_dir is missing", async () => {
    await expect(
      prepareAgentPin({
        extensions: manifestWith({
          sourceDir: "missing-dir",
          modelPlaceholder: "${RUN_MODEL}",
          inheritUserModelsJson: false,
        }),
        profilePath,
        provider: "openrouter",
        modelId: "test-model",
        runDir,
      }),
    ).rejects.toBeInstanceOf(AgentPinError);
  });

  it("throws AgentPinError when source_dir contains no *.md files", async () => {
    const sourceDir = path.join(profilePath, "agents");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, "README.txt"), "not markdown", "utf8");

    await expect(
      prepareAgentPin({
        extensions: manifestWith({
          sourceDir: "agents",
          modelPlaceholder: "${RUN_MODEL}",
          inheritUserModelsJson: false,
        }),
        profilePath,
        provider: "openrouter",
        modelId: "test-model",
        runDir,
      }),
    ).rejects.toBeInstanceOf(AgentPinError);
  });
});
