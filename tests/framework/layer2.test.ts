import path from "node:path";
import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { deriveLayer2Metrics } from "@facet/core/evaluator/layer2.js";
import { createMetricKindRegistry } from "@facet/core/registries/metric-kind-registry.js";
import type { MetricRule } from "@facet/core/runner/extensions.js";
import { register as registerPiHarness } from "@facet/harness-pi";

// Bullet 13.3: every layer2 test that exercises profile-declared metric
// rules constructs a registry and asks the harness adapter to populate
// it. The production path (Phase 14+) does this once at CLI start.
function piMetricKindRegistry() {
  const registry = createMetricKindRegistry();
  registerPiHarness({ metricKind: registry });
  return registry;
}

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const fixtureDir = path.join(repoRoot, "tests/fixtures/traces");
const fixture = (name: string): string => path.join(fixtureDir, name);

const CONTEXT_WINDOW = 1_000_000;

describe("deriveLayer2Metrics — synthetic fixtures", () => {
  it("counts files_read_unique only before the first write/edit", async () => {
    const m = await deriveLayer2Metrics({
      tracePath: fixture("reads-before-first-write.jsonl"),
      profileId: "default",
      contextWindow: CONTEXT_WINDOW,
      clarificationRequestsCount: 0,
    });
    expect(m.files_read_unique).toBe(3);
    expect(m.tool_calls_total).toBe(6);
    expect(m.tool_calls_per_type).toMatchObject({ read: 5, edit: 1 });
    expect(m.turns_to_first_edit).toBe(3);
    expect(m.repeated_file_edits).toBe(0);
  });

  it("counts repeated writes/edits as excess events on a path", async () => {
    const m = await deriveLayer2Metrics({
      tracePath: fixture("repeated-edits.jsonl"),
      profileId: "default",
      contextWindow: CONTEXT_WINDOW,
      clarificationRequestsCount: 0,
    });
    expect(m.repeated_file_edits).toBe(2);
    expect(m.tool_calls_per_type).toMatchObject({ edit: 3, write: 1 });
    expect(m.turns_to_first_edit).toBe(1);
  });

  it("counts bash commands and aggregates per-turn token usage", async () => {
    const m = await deriveLayer2Metrics({
      tracePath: fixture("bash-and-tokens.jsonl"),
      profileId: "default",
      contextWindow: CONTEXT_WINDOW,
      clarificationRequestsCount: 2,
    });
    expect(m.bash_commands_count).toBe(2);
    expect(m.tokens_in_total).toBe(4000);
    expect(m.tokens_out_total).toBe(100);
    expect(m.tokens_in_upfront).toBe(1000);
    expect(m.context_utilization_max_pct).toBeCloseTo(0.3, 5);
    expect(m.context_utilization_avg_pct).toBeCloseTo(0.2, 5);
    expect(m.clarification_requests_count).toBe(2);
  });

  it("dispatches profile-declared tool_call_count rules over the configured tool names", async () => {
    // Synthetic profile rules — these are the same kinds the factor-study
    // profiles declare, but the fixture trace and the rule names are
    // deliberately decoupled from any specific profile id so the test
    // exercises the dispatcher, not the legacy TOOL_OWNER table.
    const rules: readonly MetricRule[] = [
      {
        id: "alpha_tool_count",
        kind: "tool_call_count",
        tool_names: ["alpha_search", "alpha_inspect"],
      },
      {
        id: "beta_tool_count",
        kind: "tool_call_count",
        tool_names: ["beta_query"],
      },
      {
        id: "gamma_max_depth",
        kind: "tool_call_max_depth",
        tool_names: ["gamma_spawn"],
      },
    ];
    const m = await deriveLayer2Metrics({
      tracePath: fixture("profile-counters.jsonl"),
      profileId: "synthetic-profile",
      contextWindow: CONTEXT_WINDOW,
      clarificationRequestsCount: 0,
      metricRules: rules,
      metricKindRegistry: piMetricKindRegistry(),
    });
    expect(m.profile_metrics).toEqual({
      alpha_tool_count: 2,
      beta_tool_count: 1,
      gamma_max_depth: 1,
    });
    // Framework-static fields are unaffected by the rules.
    expect(m.tool_calls_total).toBeGreaterThan(0);
  });

  it("dispatches tool_result_marker_count rules over content[].text matches", async () => {
    const rules: readonly MetricRule[] = [
      {
        id: "warning_marker_count",
        kind: "tool_result_marker_count",
        applies_to_tools: ["write", "edit"],
        markers: ["⚠️", "🔴"],
      },
    ];
    const m = await deriveLayer2Metrics({
      tracePath: fixture("lens-warning.jsonl"),
      profileId: "synthetic-profile",
      contextWindow: CONTEXT_WINDOW,
      clarificationRequestsCount: 0,
      metricRules: rules,
      metricKindRegistry: piMetricKindRegistry(),
    });
    expect(m.profile_metrics.warning_marker_count).toBe(2);
    expect(m.tool_calls_per_type).toMatchObject({ edit: 2, write: 1 });
  });

  it("returns an empty profile_metrics record when the run declares no rules", async () => {
    const m = await deriveLayer2Metrics({
      tracePath: fixture("profile-counters.jsonl"),
      profileId: "synthetic-profile",
      contextWindow: CONTEXT_WINDOW,
      clarificationRequestsCount: 0,
    });
    expect(m.profile_metrics).toEqual({});
  });

  it("returns null turns_to_first_edit and zero counters for an empty-read trace", async () => {
    const m = await deriveLayer2Metrics({
      tracePath: fixture("bash-and-tokens.jsonl"),
      profileId: "default",
      contextWindow: CONTEXT_WINDOW,
      clarificationRequestsCount: 0,
    });
    expect(m.turns_to_first_edit).toBeNull();
    expect(m.files_read_unique).toBe(0);
    expect(m.repeated_file_edits).toBe(0);
  });

  it("reports zero context utilization when the model has no contextWindow", async () => {
    const m = await deriveLayer2Metrics({
      tracePath: fixture("bash-and-tokens.jsonl"),
      profileId: "default",
      contextWindow: 0,
      clarificationRequestsCount: 0,
    });
    expect(m.context_window_size).toBe(0);
    expect(m.context_utilization_max_pct).toBe(0);
    expect(m.context_utilization_avg_pct).toBe(0);
  });
});

// Pre-Phase-3 regression. The walking-skeleton bundle was produced before
// the FACET-owned trace schema landed (Bullet 3.4) and therefore lacks the
// `_meta` versioning record on its first line. Layer-2 must refuse to
// derive against such traces — silently consuming a foreign trace would
// hide a metric drift after a future Pi event-type rename. The bundle is
// untracked in git; this block only runs on machines that still have it
// from an earlier execution.
const walkingSkeletonRoot = path.join(
  repoRoot,
  "result-walking-skeleton-001-20260424T060814",
);
const walkingSkeletonRun = (id: string): string =>
  path.join(walkingSkeletonRoot, "runs", id, "trace.jsonl");

describe.runIf(existsSync(walkingSkeletonRoot))(
  "deriveLayer2Metrics — pre-Phase-3 trace rejection",
  () => {
    it("rejects run-0001 (no _meta line) with an unsupported-trace-version error", async () => {
      await expect(
        deriveLayer2Metrics({
          tracePath: walkingSkeletonRun("run-0001"),
          profileId: "default",
          contextWindow: 1_000_000,
          clarificationRequestsCount: 0,
        }),
      ).rejects.toThrow(/missing the FACET _meta line/);
    });

    it("rejects run-0003 (no _meta line) too — the rule is uniform across the bundle", async () => {
      await expect(
        deriveLayer2Metrics({
          tracePath: walkingSkeletonRun("run-0003"),
          profileId: "default",
          contextWindow: 1_000_000,
          clarificationRequestsCount: 0,
        }),
      ).rejects.toThrow(/missing the FACET _meta line/);
    });
  },
);

describe("deriveLayer2Metrics — version handling", () => {
  it("rejects a trace whose _meta declares a future trace_version", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const futureTrace = path.join(
      await mkdtemp(path.join(os.tmpdir(), "facet-trace-version-")),
      "trace.jsonl",
    );
    try {
      await writeFile(
        futureTrace,
        '{"_meta":{"trace_version":99,"harness":"pi","harness_version":"0.70.0"}}\n',
        "utf8",
      );
      await expect(
        deriveLayer2Metrics({
          tracePath: futureTrace,
          profileId: "default",
          contextWindow: 1_000_000,
          clarificationRequestsCount: 0,
        }),
      ).rejects.toThrow(/unsupported-trace-version/);
    } finally {
      await rm(path.dirname(futureTrace), { recursive: true, force: true });
    }
  });
});
