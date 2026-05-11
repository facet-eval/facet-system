import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  defineEvaluatorLayer,
  type EvaluatorLayerHandler,
} from "@facet/sdk/evaluator-layer";
import {
  defineExtensionsContribution,
  type ExtensionsContribution,
} from "@facet/sdk/extensions-yaml";
import {
  defineFactorKind,
  type FactorKindHandler,
} from "@facet/sdk/factor-kind";
import { defineHarness, type HarnessAdapter } from "@facet/sdk/harness";
import {
  defineMetricKind,
  type MetricKindHandler,
} from "@facet/sdk/metric-kind";
import {
  defineOutputEmitter,
  type OutputEmitterHandler,
} from "@facet/sdk/output-emitter";
import {
  parseProfilePackageManifest,
  ProfilePackageManifestSchema,
} from "@facet/sdk/profile-package";
import {
  defineTraceEventKind,
  type TraceEventKind,
} from "@facet/sdk/trace-event";
import {
  defineWorkspaceStrategy,
  type WorkspaceStrategyHandler,
} from "@facet/sdk/workspace-strategy";

// Bullet 12.1 — the SDK is pure types + identity helpers. These tests
// pin the contract: every defineX() returns its input by reference (no
// mutation, no wrapping), and the ProfilePackageManifest parser round-trips
// a minimal manifest. Phase 13.1 will move src/sdk → packages/sdk; these
// tests follow it.

describe("@facet/sdk — defineX identity helpers", () => {
  it("defineHarness returns the same reference", () => {
    const adapter: HarnessAdapter = {
      id: "fake",
      version: "0.0.0",
      async runSession() {
        return {
          finalMessage: undefined,
          events: [],
          tokenUsage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
          durationMs: 0,
          timedOut: false,
          costUsd: 0,
          clarificationRequestsCount: 0,
          contextWindow: 0,
        };
      },
    };
    expect(defineHarness(adapter)).toBe(adapter);
  });

  it("defineFactorKind returns the same reference", () => {
    const handler: FactorKindHandler<{ id: string }> = {
      id: "fake_swap",
      levelSchema: z.object({ id: z.string() }),
      expand: (factor) =>
        (factor as { levels: readonly { id: string }[] }).levels.map(
          (level) => ({
            factorId: factor.id,
            levelId: level.id,
            level,
          }),
        ),
      apply: (value, draft) => {
        draft["fake"] = value.levelId;
      },
    };
    expect(defineFactorKind(handler)).toBe(handler);
  });

  it("defineTraceEventKind returns the same reference", () => {
    const kind: TraceEventKind<{ type: "fake"; timestamp: string }> = {
      id: "fake",
      schema: z.object({ type: z.literal("fake"), timestamp: z.string() }),
    };
    expect(defineTraceEventKind(kind)).toBe(kind);
  });

  it("defineMetricKind returns the same reference", () => {
    const handler: MetricKindHandler<{ threshold: number }> = {
      id: "fake_metric",
      configSchema: z.object({ threshold: z.number() }),
      consumes: ["turn_end"],
      initialState: () => 0,
      evaluate: (_event, state) => (state as number) + 1,
      finalize: (state) => state as number,
    };
    expect(defineMetricKind(handler)).toBe(handler);
  });

  it("defineEvaluatorLayer returns the same reference", () => {
    const handler: EvaluatorLayerHandler<{ script: string }> = {
      id: "fake_layer",
      configSchema: z.object({ script: z.string() }),
      async evaluate(_input, _config) {
        return { id: "fake", passed: true };
      },
    };
    expect(defineEvaluatorLayer(handler)).toBe(handler);
  });

  it("defineOutputEmitter returns the same reference", () => {
    const handler: OutputEmitterHandler = {
      id: "fake_emit",
      async emit() {},
    };
    expect(defineOutputEmitter(handler)).toBe(handler);
  });

  it("defineWorkspaceStrategy returns the same reference", () => {
    const handler: WorkspaceStrategyHandler<undefined> = {
      id: "fake_strategy",
      async prepare(input) {
        return {
          path: input.bundlePath,
          async cleanup() {},
        };
      },
    };
    expect(defineWorkspaceStrategy(handler)).toBe(handler);
  });

  it("defineExtensionsContribution returns the same reference", () => {
    const contribution: ExtensionsContribution<{ enabled: boolean }> = {
      key: "fake_block",
      schema: z.object({ enabled: z.boolean() }),
    };
    expect(defineExtensionsContribution(contribution)).toBe(contribution);
  });
});

describe("@facet/sdk — ProfilePackageManifest parser", () => {
  it("round-trips a minimal manifest", () => {
    const raw = {
      profileRoot: "./profile",
      harness: "@facet/harness-pi",
      harnessVersionRange: "^1",
    };
    const parsed = parseProfilePackageManifest(raw);
    expect(parsed.profileRoot).toBe("./profile");
    expect(parsed.harness).toBe("@facet/harness-pi");
    expect(parsed.harnessVersionRange).toBe("^1");
    expect(parsed.hash).toBeUndefined();
  });

  it("preserves an optional hash", () => {
    const parsed = parseProfilePackageManifest({
      profileRoot: "./profile",
      harness: "@facet/harness-pi",
      harnessVersionRange: "^1",
      hash: "sha256:deadbeef",
    });
    expect(parsed.hash).toBe("sha256:deadbeef");
  });

  it("rejects unknown top-level keys (strict schema)", () => {
    expect(() =>
      parseProfilePackageManifest({
        profileRoot: "./profile",
        harness: "@facet/harness-pi",
        harnessVersionRange: "^1",
        extraField: "not allowed",
      }),
    ).toThrow();
  });

  it("rejects a missing required field", () => {
    expect(() =>
      ProfilePackageManifestSchema.parse({
        profileRoot: "./profile",
        harness: "@facet/harness-pi",
      }),
    ).toThrow();
  });
});
