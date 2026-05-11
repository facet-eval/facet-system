import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { defineWorkspaceStrategy } from "@facet/sdk/workspace-strategy";
import { createWorkspaceStrategyRegistry } from "@facet/core/registries/workspace-strategy-registry.js";

// Bullet 16.1 — workspace_strategy dispatch is registry-driven. The
// spec schema accepts any non-empty string; the runner resolves the
// handler at dispatch time and emits a "Unknown workspace_strategy"
// runtime error when nothing matches. This test verifies the
// registry contract end-to-end with a synthetic in-memory strategy —
// no Pi or git worktree required.

describe("workspace-strategy registry — Bullet 16.1", () => {
  it("dispatches `prepare(input, config)` to the registered handler", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "facet-ws-"));
    try {
      const registry = createWorkspaceStrategyRegistry();
      let cleanedUp = false;
      const inMemoryStrategy = defineWorkspaceStrategy({
        id: "in_memory_synthetic",
        async prepare(input) {
          // Pretend the strategy materialized something at this path.
          // A real plugin would mount tmpfs / spin up a container /
          // resolve a per-run directory; here we just use the tmpdir.
          const workspaceDir = path.join(tmpRoot, input.runId);
          return {
            path: workspaceDir,
            async cleanup() {
              cleanedUp = true;
            },
          };
        },
      });
      registry.register(inMemoryStrategy);

      const handler = registry.get("in_memory_synthetic");
      expect(handler).toBeDefined();
      const handle = await handler!.prepare(
        {
          scenarioPath: path.join(tmpRoot, "scenario"),
          scenarioId: "demo",
          codeDir: "repo",
          runId: "run-0001",
          bundlePath: path.join(tmpRoot, "bundle"),
        },
        undefined,
      );
      expect(handle.path.endsWith("run-0001")).toBe(true);
      await handle.cleanup();
      expect(cleanedUp).toBe(true);
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("registry.get returns undefined for unknown strategies (runner emits the user-facing error)", () => {
    const registry = createWorkspaceStrategyRegistry();
    expect(registry.get("docker_container")).toBeUndefined();
  });
});
