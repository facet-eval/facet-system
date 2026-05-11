import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatRunId } from "@facet/core/bundle/naming.js";
import { BundleWriter, type RunConfig } from "@facet/core/bundle/writer.js";
import {
  loadProfileDefinition,
  loadScenarioDefinition,
  runSingleRun,
  type ProfileDefinition,
  type ScenarioDefinition,
} from "@facet/core/runner/index.js";
import { defineHarness } from "@facet/sdk/harness";
import { loadSpec } from "@facet/core/spec/loader.js";
import type { ExperimentSpec, ModelLevel } from "@facet/core/spec/schema.js";

const FIXTURE_PACKAGE = path.resolve(
  __dirname, "..",
  "fixtures",
  "parallel-acceptance",
);
const COMPOUND_PYTHON_SCENARIO = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "compound-python",
);

describe("runSingleRun — context-window warning (Phase 9 / Bullet 9.3 — F-32)", () => {
  let outDir: string;
  let spec: ExperimentSpec;
  let bundleWriter: BundleWriter;
  let profileDef: ProfileDefinition;
  let scenarioDef: ScenarioDefinition;
  let modelLevel: ModelLevel;
  let runConfig: RunConfig;

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), "facet-context-window-"));
    spec = await loadSpec(path.join(FIXTURE_PACKAGE, "spec.yaml"));
    bundleWriter = new BundleWriter(outDir);
    await bundleWriter.initBundle(path.join(FIXTURE_PACKAGE, "spec.yaml"), spec);

    const profileFactor = spec.varying_factors.find((f) => f.id === "profile");
    if (profileFactor === undefined || profileFactor.type !== "extension_select") {
      throw new Error("fixture must declare an extension_select factor");
    }
    const profileLevel = profileFactor.levels[0]!;
    profileDef = await loadProfileDefinition(
      FIXTURE_PACKAGE,
      profileLevel.ref,
      profileLevel.id,
    );

    const scenario = spec.scenarios[0]!;
    const scenarioCopy = path.join(outDir, "fixtures", "compound-python");
    await cp(COMPOUND_PYTHON_SCENARIO, scenarioCopy, { recursive: true });
    scenarioDef = await loadScenarioDefinition(
      path.join(outDir, "fixtures"),
      "compound-python",
      scenario.id,
    );

    const modelFactor = spec.varying_factors.find((f) => f.id === "model");
    if (modelFactor === undefined || modelFactor.type !== "model_swap") {
      throw new Error("fixture must declare a model_swap factor");
    }
    modelLevel = modelFactor.levels[0]!;

    runConfig = {
      runId: formatRunId(1),
      promptId: "underspecified",
      profileId: profileLevel.id,
      modelLevelId: modelLevel.id,
      provider: modelLevel.provider,
      modelId: modelLevel.model_id,
      scenarioId: scenario.id,
      repetition: 1,
    };
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("writes summary.json.warnings: ['context-window-unknown'] when the harness reports contextWindow=0", async () => {
    await runSingleRun({
      spec,
      runConfig,
      modelLevel,
      scenarioDef,
      profileDef,
      bundleWriter,
      timeoutMs: 60_000,
      oracleTimeoutMs: 60_000,
      apiKeys: { openrouter: "test-stub-key" },
      harness: defineHarness({
        id: "test-fake",
        version: "0.0.0",
        async runSession() {
          return {
            finalMessage: undefined,
            events: [],
            tokenUsage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, total: 20 },
            durationMs: 5,
            timedOut: false,
            costUsd: 0.00001,
            clarificationRequestsCount: 0,
            contextWindow: 0,
          };
        },
      }),
    });

    const summary = JSON.parse(
      await readFile(
        path.join(bundleWriter.bundlePath, "runs", runConfig.runId, "summary.json"),
        "utf8",
      ),
    );
    expect(summary.warnings).toEqual(["context-window-unknown"]);
  });

  it("omits the warnings field when the harness reports a real contextWindow", async () => {
    await runSingleRun({
      spec,
      runConfig,
      modelLevel,
      scenarioDef,
      profileDef,
      bundleWriter,
      timeoutMs: 60_000,
      oracleTimeoutMs: 60_000,
      apiKeys: { openrouter: "test-stub-key" },
      harness: defineHarness({
        id: "test-fake",
        version: "0.0.0",
        async runSession() {
          return {
            finalMessage: undefined,
            events: [],
            tokenUsage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, total: 20 },
            durationMs: 5,
            timedOut: false,
            costUsd: 0.00001,
            clarificationRequestsCount: 0,
            contextWindow: 1_000_000,
          };
        },
      }),
    });

    const summary = JSON.parse(
      await readFile(
        path.join(bundleWriter.bundlePath, "runs", runConfig.runId, "summary.json"),
        "utf8",
      ),
    );
    expect(summary.warnings).toBeUndefined();
  });
});
