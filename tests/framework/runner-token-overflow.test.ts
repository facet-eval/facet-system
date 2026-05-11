import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatRunId } from "@facet/core/bundle/naming.js";
import { BundleWriter, type RunConfig } from "@facet/core/bundle/writer.js";
import {
  loadProfileDefinition,
  loadScenarioDefinition,
  runSingleRun,
  TokenOverflowError,
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

describe("runSingleRun — token overflow (F-30 / G-05)", () => {
  let outDir: string;
  let spec: ExperimentSpec;
  let bundleWriter: BundleWriter;
  let profileDef: ProfileDefinition;
  let scenarioDef: ScenarioDefinition;
  let modelLevel: ModelLevel;
  let runConfig: RunConfig;

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), "facet-token-overflow-"));
    spec = await loadSpec(path.join(FIXTURE_PACKAGE, "spec.yaml"));
    bundleWriter = new BundleWriter(outDir);
    await bundleWriter.initBundle(path.join(FIXTURE_PACKAGE, "spec.yaml"), spec);

    const profileFactor = spec.varying_factors.find((f) => f.id === "profile");
    if (profileFactor === undefined || profileFactor.id !== "profile") {
      throw new Error("fixture must declare a profile factor");
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
    if (modelFactor === undefined || modelFactor.id !== "model") {
      throw new Error("fixture must declare a model factor");
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

  it("throws TokenOverflowError when result.tokenUsage.total exceeds spec.environment.max_tokens_per_run", async () => {
    const cappedSpec: ExperimentSpec = {
      ...spec,
      environment: { ...spec.environment, max_tokens_per_run: 100 },
    };

    await expect(
      runSingleRun({
        spec: cappedSpec,
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
              tokenUsage: { input: 60, output: 60, cacheRead: 0, cacheWrite: 0, total: 120 },
              durationMs: 5,
              timedOut: false,
              costUsd: 0.0001,
              clarificationRequestsCount: 0,
              contextWindow: 0,
            };
          },
        }),
      }),
    ).rejects.toMatchObject({
      name: "TokenOverflowError",
      message: expect.stringContaining(`exceeding max_tokens_per_run=100`),
    });
  });

  it("does not raise TokenOverflowError when total tokens equal the cap", async () => {
    // The check is `tokensTotal > max`, so total === max should pass. We
    // assert that the specific error class does not appear, regardless of
    // whether downstream evaluator/oracle raise something unrelated.
    const cappedSpec: ExperimentSpec = {
      ...spec,
      environment: { ...spec.environment, max_tokens_per_run: 200 },
    };

    let thrown: unknown;
    try {
      await runSingleRun({
        spec: cappedSpec,
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
              tokenUsage: { input: 100, output: 100, cacheRead: 0, cacheWrite: 0, total: 200 },
              durationMs: 5,
              timedOut: false,
              costUsd: 0.0001,
              clarificationRequestsCount: 0,
              contextWindow: 0,
            };
          },
        }),
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown instanceof TokenOverflowError).toBe(false);
  });
});
