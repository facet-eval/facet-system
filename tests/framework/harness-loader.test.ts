import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HarnessLoadError, loadHarness } from "@facet/core/harness-loader.js";

// Bullet 16.3 — `loadHarness(packageName, contextDir)` is the only seam
// in `@facet/core` that loads a HarnessAdapter. These tests verify the
// contract end-to-end with an in-process fake harness written as a
// local `.mjs` file: the loader resolves the relative ref, imports it
// via `pathToFileURL`, picks up the `default` export, returns the
// `register` hook, and surfaces a clear `HarnessLoadError` for the
// negative cases (missing file, missing default export).

describe("loadHarness — Bullet 16.3", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "facet-harness-"));
  });
  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("resolves a relative .mjs harness and returns its adapter + register hook", async () => {
    // Inline fake harness: just enough to satisfy the HarnessAdapter
    // contract (id, version, runSession) + an optional register hook
    // that pushes a token into a side-channel array so we can verify
    // the loader actually returned the hook.
    const harnessSrc = `
      export default {
        id: "fake-harness",
        version: "9.9.9",
        async runSession() {
          return {
            finalMessage: "noop",
            events: [],
            tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            durationMs: 0,
            timedOut: false,
            costUsd: 0,
            clarificationRequestsCount: 0,
            contextWindow: 0,
          };
        },
      };
      export function register(registries) {
        registries.__test_token = "registered";
      }
    `;
    const harnessFile = path.join(tmpRoot, "fake-harness.mjs");
    await writeFile(harnessFile, harnessSrc, "utf8");

    const loaded = await loadHarness("./fake-harness.mjs", tmpRoot);
    expect(loaded.adapter.id).toBe("fake-harness");
    expect(loaded.adapter.version).toBe("9.9.9");
    expect(typeof loaded.adapter.runSession).toBe("function");
    expect(typeof loaded.register).toBe("function");

    const sideChannel: { __test_token?: string } = {};
    await loaded.register!(sideChannel);
    expect(sideChannel.__test_token).toBe("registered");
  });

  it("rejects a missing harness file with HarnessLoadError", async () => {
    await expect(
      loadHarness("./does-not-exist.mjs", tmpRoot),
    ).rejects.toThrow(HarnessLoadError);
  });

  it("rejects a module without a default HarnessAdapter export", async () => {
    const badSrc = `export const someNamedExport = 42;`;
    const badFile = path.join(tmpRoot, "bad-harness.mjs");
    await writeFile(badFile, badSrc, "utf8");
    await expect(
      loadHarness("./bad-harness.mjs", tmpRoot),
    ).rejects.toThrow(/default HarnessAdapter/);
  });

  it("returns no register hook when the module does not export one", async () => {
    const src = `
      export default {
        id: "no-register",
        version: "1.0.0",
        async runSession() {
          return {
            finalMessage: "",
            events: [],
            tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            durationMs: 0,
            timedOut: false,
            costUsd: 0,
            clarificationRequestsCount: 0,
            contextWindow: 0,
          };
        },
      };
    `;
    const file = path.join(tmpRoot, "no-register.mjs");
    await writeFile(file, src, "utf8");
    const loaded = await loadHarness("./no-register.mjs", tmpRoot);
    expect(loaded.adapter.id).toBe("no-register");
    expect(loaded.register).toBeUndefined();
  });
});
