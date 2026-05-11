import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AGGREGATED_CSV_STATIC_COLUMNS,
  writeAggregatedCSV,
} from "@facet/core/bundle/aggregate.js";
import { hashDirectory, writeManifest } from "@facet/core/bundle/manifest.js";
import { loadSpec } from "@facet/core/spec/loader.js";
import type { ExperimentSpec } from "@facet/core/spec/schema.js";
import { expandMatrix, type MatrixEntry } from "@facet/core/runner/index.js";
import type { MatrixRunReport } from "@facet/core/bundle/manifest.js";

const HELLO_WORLD = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "examples",
  "hello-world-experiment",
);

async function stageBundle(
  sandbox: string,
  packageRoot: string,
  runs: readonly MatrixEntry[],
): Promise<{ bundlePath: string }> {
  const bundlePath = path.join(sandbox, "bundle");
  await mkdir(path.join(bundlePath, "runs"), { recursive: true });
  await cp(path.join(packageRoot, "spec.yaml"), path.join(bundlePath, "spec.yaml"));
  for (const entry of runs) {
    const runDir = path.join(bundlePath, "runs", entry.runConfig.runId);
    await mkdir(runDir, { recursive: true });
    const configYaml = [
      `run_id: ${entry.runConfig.runId}`,
      `prompt_id: ${entry.runConfig.promptId}`,
      `profile: ${entry.runConfig.profileId}`,
      `model: ${entry.runConfig.modelLevelId}`,
      `provider: ${entry.runConfig.provider}`,
      `model_id: ${entry.runConfig.modelId}`,
      `scenario: ${entry.runConfig.scenarioId}`,
      `repetition: ${entry.runConfig.repetition}`,
      "",
    ].join("\n");
    await writeFile(path.join(runDir, "config.yaml"), configYaml, "utf8");
    await writeFile(
      path.join(runDir, "summary.json"),
      JSON.stringify(
        {
          run_id: entry.runConfig.runId,
          status: "completed_passed",
          duration_ms: 1200 + entry.runConfig.repetition * 10,
          tokens_in: 800,
          tokens_out: 120,
          tokens_total: 920,
          cost_usd: 0.0001,
          timed_out: false,
          tasks_passed: 3,
          tasks_total: 3,
          regression_tests_passed: 4,
          regression_tests_total: 4,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(runDir, "tests.json"),
      JSON.stringify(
        {
          version: "v2",
          run_id: entry.runConfig.runId,
          passed: true,
          exit_code: 0,
          duration_ms: 400,
          timed_out: false,
          tasks_total: 3,
          tasks_passed: 3,
          regression_tests_total: 4,
          regression_tests_passed: 4,
          per_task: [
            { id: "task1", passed: true },
            { id: "task2", passed: true },
            { id: "task3", passed: true },
          ],
          regression: [
            { id: "reg1", passed: true },
            { id: "reg2", passed: true },
            { id: "reg3", passed: true },
            { id: "reg4", passed: true },
          ],
          layers: [],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }
  return { bundlePath };
}

function buildReports(entries: readonly MatrixEntry[]): MatrixRunReport[] {
  return entries.map((e) => ({
    runConfig: e.runConfig,
    status: "completed_passed",
    durationMs: 1200,
    tokensIn: 800,
    tokensOut: 120,
    tokensTotal: 920,
    costUsd: 0.0001,
  }));
}

describe("expandMatrix", () => {
  it("produces 4 runs for the hello-world spec (2 prompts × 2 reps × 1 profile × 1 model × 1 scenario)", async () => {
    const spec = await loadSpec(path.join(HELLO_WORLD, "spec.yaml"));
    const entries = expandMatrix(spec);
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.runConfig.runId)).toEqual([
      "run-0001",
      "run-0002",
      "run-0003",
      "run-0004",
    ]);
    expect(entries.map((e) => e.runConfig.promptId)).toEqual([
      "underspecified",
      "underspecified",
      "specific",
      "specific",
    ]);
    expect(entries.map((e) => e.runConfig.repetition)).toEqual([1, 2, 1, 2]);
    for (const entry of entries) {
      expect(entry.runConfig.scenarioId).toBe("fizzbuzz-off-by-one");
      expect(entry.runConfig.profileId).toBe("default");
      expect(entry.modelLevel.provider).toBe("openrouter");
    }
  });
});

describe("writeAggregatedCSV", () => {
  let sandbox: string;
  let spec: ExperimentSpec;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), "facet-bundle-"));
    spec = await loadSpec(path.join(HELLO_WORLD, "spec.yaml"));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("emits a CSV with the static-column header (no profile metrics declared) + one row per run", async () => {
    const entries = expandMatrix(spec);
    const { bundlePath } = await stageBundle(sandbox, HELLO_WORLD, entries);

    const csvPath = await writeAggregatedCSV(bundlePath);
    const csvText = await readFile(csvPath, "utf8");
    const lines = csvText.trim().split("\n");

    // hello-world's profile-default declares no `metrics:` block, so the
    // header is exactly the static set — no dynamic columns appended.
    expect(lines[0]).toBe([...AGGREGATED_CSV_STATIC_COLUMNS].join(","));
    expect(lines.length - 1).toBe(4);

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!;
      const row = lines[i + 1]!.split(",");
      expect(row[0]).toBe(entry.runConfig.runId);
      expect(row[1]).toBe(entry.runConfig.promptId);
      expect(row[2]).toBe(entry.runConfig.profileId);
      expect(row[3]).toBe(entry.runConfig.modelLevelId);
      expect(row[4]).toBe(entry.runConfig.scenarioId);
      expect(row[5]).toBe(String(entry.runConfig.repetition));
      expect(row[6]).toBe("1"); // tests_passed
      expect(row[7]).toBe("0"); // exit_code
      expect(row[11]).toBe("3"); // tasks_passed
      expect(row[12]).toBe("4"); // regression_tests_passed
      expect(row[13]).toBe("4"); // regression_tests_total
    }
  });

  it("writes empty cells when summary.json or tests.json are missing", async () => {
    const entries = expandMatrix(spec);
    const { bundlePath } = await stageBundle(sandbox, HELLO_WORLD, entries);
    // Drop summary.json and tests.json for run-0002 to simulate a partial crash
    await rm(path.join(bundlePath, "runs", "run-0002", "summary.json"));
    await rm(path.join(bundlePath, "runs", "run-0002", "tests.json"));

    const csvPath = await writeAggregatedCSV(bundlePath);
    const lines = (await readFile(csvPath, "utf8")).trim().split("\n");
    const row2 = lines[2]!.split(",");
    expect(row2[0]).toBe("run-0002");
    expect(row2[6]).toBe(""); // tests_passed
    expect(row2[7]).toBe(""); // exit_code
    expect(row2[8]).toBe(""); // duration_ms
    expect(row2[9]).toBe(""); // tokens_in
    expect(row2[10]).toBe(""); // tokens_out
    expect(row2[11]).toBe(""); // tasks_passed
    expect(row2[12]).toBe(""); // regression_tests_passed
    expect(row2[13]).toBe(""); // regression_tests_total
  });

  it("appends profile-declared metric keys as dynamic columns (Phase 4)", async () => {
    const entries = expandMatrix(spec);
    const { bundlePath } = await stageBundle(sandbox, HELLO_WORLD, entries);
    // Stage metrics.json on run-0001 with: framework-static fields +
    // synthetic profile-declared metrics (the kind of payload Phase 4's
    // flattenLayer2 produces). Layer-2 keys not in the static set are
    // emitted as dynamic columns sorted by id.
    await writeFile(
      path.join(bundlePath, "runs", "run-0001", "metrics.json"),
      JSON.stringify(
        {
          tool_calls_total: 7,
          tool_calls_per_type: { read: 3, edit: 2, bash: 2 },
          files_read_unique: 3,
          turns_to_first_edit: 2,
          repeated_file_edits: 1,
          clarification_requests_count: 1,
          bash_commands_count: 2,
          tokens_in_total: 5000,
          tokens_out_total: 300,
          tokens_in_upfront: 1200,
          context_window_size: 1_000_000,
          context_utilization_max_pct: 0.5,
          context_utilization_avg_pct: 0.3,
          // Synthetic profile metrics. Dynamic columns appear after the
          // static set, sorted by metric id.
          alpha_count: 5,
          beta_warnings: 2,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const csvPath = await writeAggregatedCSV(bundlePath);
    const lines = (await readFile(csvPath, "utf8")).trim().split("\n");
    const header = lines[0]!.split(",");

    // The dynamic columns appear after the static set, sorted alphabetically.
    expect(header).toEqual([
      ...AGGREGATED_CSV_STATIC_COLUMNS,
      "alpha_count",
      "beta_warnings",
    ]);

    const idx = (name: string): number => header.indexOf(name);
    const row1 = lines[1]!.split(",");
    expect(row1[idx("tool_calls_total")]).toBe("7");
    expect(row1[idx("files_read_unique")]).toBe("3");
    expect(row1[idx("alpha_count")]).toBe("5");
    expect(row1[idx("beta_warnings")]).toBe("2");

    // run-0002 has no metrics.json — its row has the dynamic columns
    // present (header is union across rows) but empty.
    const row2 = lines[2]!.split(",");
    expect(row2[idx("alpha_count")]).toBe("");
    expect(row2[idx("beta_warnings")]).toBe("");
  });
});

describe("writeManifest", () => {
  let sandbox: string;
  let packageRoot: string;
  let spec: ExperimentSpec;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), "facet-manifest-"));
    packageRoot = path.join(sandbox, "package");
    await cp(HELLO_WORLD, packageRoot, { recursive: true });
    spec = await loadSpec(path.join(packageRoot, "spec.yaml"));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("writes a manifest.yaml with non-TBD sha256 hashes for spec, scenario, and profile", async () => {
    const entries = expandMatrix(spec);
    const { bundlePath } = await stageBundle(sandbox, packageRoot, entries);

    const doc = await writeManifest(bundlePath, spec, {
      packageRoot,
      startedAt: new Date("2026-04-24T10:00:00Z"),
      finishedAt: new Date("2026-04-24T10:05:00Z"),
      reports: buildReports(entries),
    });

    const manifestText = await readFile(path.join(bundlePath, "manifest.yaml"), "utf8");
    const manifestParsed = parseYaml(manifestText) as Record<string, unknown>;
    const hashRe = /^sha256:[0-9a-f]{64}$/;

    expect(doc.spec.hash).toMatch(hashRe);
    expect((manifestParsed.spec as { hash: string }).hash).toMatch(hashRe);

    expect(doc.scenarios).toHaveLength(1);
    expect(doc.scenarios[0]!.hash).toMatch(hashRe);
    expect(doc.scenarios[0]!.hash).not.toBe("TBD");

    expect(doc.profiles).toHaveLength(1);
    expect(doc.profiles[0]!.hash).toMatch(hashRe);
    expect(doc.profiles[0]!.hash).not.toBe("TBD");

    // Bullet 14.2 — the hello-world spec now references the profile by
    // npm name, so the manifest's `profiles[]` entry carries the package
    // identity and the resolved path inside `node_modules`. Replay tools
    // can use these to trace the bundle back to its exact preset.
    expect(doc.profiles[0]!.package_name).toBe("@facet/preset-pi-default");
    expect(typeof doc.profiles[0]!.package_version).toBe("string");
    expect(doc.profiles[0]!.facet_hash).toMatch(hashRe);
    expect(typeof doc.profiles[0]!.resolved_path).toBe("string");

    const hashCount = (manifestText.match(/hash:/g) ?? []).length;
    expect(hashCount).toBeGreaterThanOrEqual(3);

    expect(doc.runs).toHaveLength(4);
    for (const run of doc.runs) {
      expect(run.status).toBe("completed_passed");
    }
    expect(doc.pi_version).toBe(spec.metadata.harness.version);
    expect(doc.framework_version).toBe(spec.metadata.framework_version);
  });

  it("records failure and timeout statuses per run", async () => {
    const entries = expandMatrix(spec);
    const { bundlePath } = await stageBundle(sandbox, packageRoot, entries);

    const reports: MatrixRunReport[] = [
      {
        runConfig: entries[0]!.runConfig,
        status: "completed_passed",
        durationMs: 1000,
        tokensIn: 50,
        tokensOut: 10,
        tokensTotal: 60,
        costUsd: 0.00001,
        tasksPassed: 3,
        tasksTotal: 3,
        regressionTestsPassed: 4,
        regressionTestsTotal: 4,
      },
      {
        runConfig: entries[1]!.runConfig,
        status: "timeout",
        durationMs: 300_000,
      },
      {
        runConfig: entries[2]!.runConfig,
        status: "error",
        error: { name: "RunnerError", message: "simulated crash" },
      },
      {
        runConfig: entries[3]!.runConfig,
        status: "partially_completed",
        durationMs: 1100,
        tasksPassed: 2,
        tasksTotal: 3,
      },
    ];

    const doc = await writeManifest(bundlePath, spec, {
      packageRoot,
      startedAt: new Date("2026-04-24T10:00:00Z"),
      finishedAt: new Date("2026-04-24T10:06:00Z"),
      reports,
    });

    expect(doc.runs.map((r) => r.status)).toEqual([
      "completed_passed",
      "timeout",
      "error",
      "partially_completed",
    ]);
    const failure = doc.runs[2]!;
    expect(failure.error?.message).toBe("simulated crash");
    const completed = doc.runs[0]!;
    expect(completed.tasks_passed).toBe(3);
    expect(completed.tasks_total).toBe(3);
    expect(completed.regression_tests_passed).toBe(4);
    expect(completed.regression_tests_total).toBe(4);
    const partial = doc.runs[3]!;
    expect(partial.tasks_passed).toBe(2);
    expect(partial.tasks_total).toBe(3);
  });

  it("emits a provenance block and a sibling spec.normalized.yaml (Phase 7 / Bullet 7.5)", async () => {
    const entries = expandMatrix(spec);
    const { bundlePath } = await stageBundle(sandbox, packageRoot, entries);

    const doc = await writeManifest(bundlePath, spec, {
      packageRoot,
      startedAt: new Date("2026-04-24T10:00:00Z"),
      finishedAt: new Date("2026-04-24T10:05:00Z"),
      reports: buildReports(entries),
    });

    expect(doc.provenance.spec.seed).toBe(spec.metadata.seed);
    expect(doc.provenance.spec.started_at).toBe("2026-04-24T10:00:00.000Z");
    expect(doc.provenance.spec.finished_at).toBe("2026-04-24T10:05:00.000Z");
    expect(doc.provenance.framework.declared_version).toBe(
      spec.metadata.framework_version,
    );
    expect(doc.provenance.pi.declared_version).toBe(
      spec.metadata.harness.version,
    );
    expect(doc.provenance.runtime.node_version).toBe(process.version);
    expect(doc.provenance.runtime.platform).toBe(process.platform);
    expect(doc.provenance.runtime.arch).toBe(process.arch);
    expect(typeof doc.provenance.framework.git_dirty).toBe("boolean");

    // spec.normalized.yaml exists, has a sha256 in the manifest, and the
    // canonical content survives a round-trip without the source spec
    // changing.
    expect(doc.spec.normalized_path).toBe("spec.normalized.yaml");
    expect(doc.spec.normalized_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const normalized = await readFile(
      path.join(bundlePath, "spec.normalized.yaml"),
      "utf8",
    );
    const original = await readFile(
      path.join(bundlePath, "spec.yaml"),
      "utf8",
    );
    // The normalized form may not be byte-identical (key order canonicalized)
    // but the spec body always round-trips to the same Zod parse.
    expect(parseYaml(normalized)).toEqual(parseYaml(original));
  });

  it("populates manifest.outputs with sha256 for every per-run artifact (Phase 10 / Bullet 10.3)", async () => {
    const entries = expandMatrix(spec);
    const { bundlePath } = await stageBundle(sandbox, packageRoot, entries);

    const doc = await writeManifest(bundlePath, spec, {
      packageRoot,
      startedAt: new Date("2026-04-24T10:00:00Z"),
      finishedAt: new Date("2026-04-24T10:05:00Z"),
      reports: buildReports(entries),
    });

    const hashRe = /^sha256:[0-9a-f]{64}$/;
    // stageBundle writes config.yaml, summary.json, tests.json per run.
    // Every existing artifact is hashed; non-existent ones are skipped.
    for (const run of doc.runs) {
      expect(doc.outputs[`runs/${run.run_id}/config.yaml`]).toMatch(hashRe);
      expect(doc.outputs[`runs/${run.run_id}/summary.json`]).toMatch(hashRe);
      expect(doc.outputs[`runs/${run.run_id}/tests.json`]).toMatch(hashRe);
      // metrics.json was not staged for the default fixture — should be absent.
      expect(doc.outputs[`runs/${run.run_id}/metrics.json`]).toBeUndefined();
    }
  });

  it("produces a different scenario hash if a scenario file is modified", async () => {
    const scenarioPath = path.resolve(packageRoot, spec.scenarios[0]!.ref);
    const fizzbuzzPath = path.join(scenarioPath, "repo", "src", "fizzbuzz.ts");

    const before = await hashDirectory(scenarioPath);
    const original = await readFile(fizzbuzzPath, "utf8");
    await writeFile(fizzbuzzPath, original + "\n// perturbation\n", "utf8");
    const after = await hashDirectory(scenarioPath);

    expect(before).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(after).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
  });
});

