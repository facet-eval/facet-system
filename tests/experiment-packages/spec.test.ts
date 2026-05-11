import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, SpecLoadError } from "@facet/core/spec/loader.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const examplePackage = path.join(repoRoot, "examples/hello-world-experiment");

describe("loadSpec — valid spec", () => {
  it("parses the hello-world example and returns a typed spec", async () => {
    const spec = await loadSpec(path.join(examplePackage, "spec.yaml"));

    expect(spec.metadata.id).toBe("walking-skeleton-001");
    expect(spec.metadata.seed).toBe(42);

    expect(spec.environment.timeout_per_run_seconds).toBe(300);
    expect(spec.environment.workspace_strategy).toBe("git_worktree");

    expect(spec.varying_factors).toHaveLength(3);
    const promptFactor = spec.varying_factors.find((f) => f.id === "prompt_id");
    expect(promptFactor).toBeDefined();
    if (promptFactor && promptFactor.id === "prompt_id") {
      expect(promptFactor.levels.map((l) => l.id)).toEqual([
        "underspecified",
        "specific",
      ]);
    }

    expect(spec.scenarios).toHaveLength(1);
    expect(spec.scenarios[0]?.id).toBe("fizzbuzz-off-by-one");

    expect(spec.design.repetitions).toBe(2);
    expect(spec.design.parallelism).toBe(1);

    expect(spec.metrics.judge).toBeNull();
    expect(spec.analysis.type).toBe("none");
  });
});

describe("loadSpec — invalid or malformed input", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "facet-spec-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("throws SpecLoadError with a readable message for a missing required field", async () => {
    const specPath = path.join(tmpDir, "missing-metadata.yaml");
    // metadata is missing `seed`
    const yaml = `metadata:
  id: x
  name: x
  description: x
  version: "0.1.0"
  author: x
  framework_version: "0.1.0"
  harness:
    id: "pi"
    package: "@facet/harness-pi"
    version: "0.1.0"
environment:
  timeout_per_run_seconds: 300
  max_tokens_per_run: 1000
  max_total_cost_usd: 0.5
  workspace_strategy: git_worktree
varying_factors:
  - id: prompt_id
    description: ""
    levels:
      - id: a
scenarios:
  - id: s
    ref: s
    hash: "TBD"
design:
  type: full_factorial
  repetitions: 1
  parallelism: 1
comparisons: []
metrics:
  trace:
    capture: [tool_calls]
  evaluator:
    layers:
      - id: correctness
        type: oracle_script
        script: oracle/run.sh
        pass_condition: "exit_code == 0"
  judge: null
analysis:
  type: none
  emit: [results_table_csv]
`;
    await writeFile(specPath, yaml, "utf8");

    await expect(loadSpec(specPath)).rejects.toThrow(SpecLoadError);
    await expect(loadSpec(specPath)).rejects.toThrow(/metadata\.seed/);
  });

  it("throws SpecLoadError when an enum value is out of range", async () => {
    // Bullet 16.1 — `workspace_strategy` moved off `z.enum([...])` to
    // `z.string().min(1)` so plugins can contribute new strategies via
    // `metadata.plugins[]`. Schema-level rejection of unknown enum
    // values is still tested via `design.type`, which stays closed
    // because the matrix expansion code branches on it.
    const specPath = path.join(tmpDir, "bad-enum.yaml");
    const yaml = `metadata:
  id: x
  name: x
  description: x
  version: "0.1.0"
  author: x
  seed: 42
  framework_version: "0.1.0"
  harness:
    id: "pi"
    package: "@facet/harness-pi"
    version: "0.1.0"
environment:
  timeout_per_run_seconds: 300
  max_tokens_per_run: 1000
  max_total_cost_usd: 0.5
  workspace_strategy: git_worktree
varying_factors:
  - id: prompt_id
    description: ""
    levels:
      - id: a
scenarios:
  - id: s
    ref: s
    hash: "TBD"
design:
  type: not_a_valid_design
  repetitions: 1
  parallelism: 1
comparisons: []
metrics:
  trace:
    capture: [tool_calls]
  evaluator:
    layers:
      - id: correctness
        type: oracle_script
        script: oracle/run.sh
        pass_condition: "exit_code == 0"
  judge: null
analysis:
  type: none
  emit: [results_table_csv]
`;
    await writeFile(specPath, yaml, "utf8");

    await expect(loadSpec(specPath)).rejects.toThrow(SpecLoadError);
    await expect(loadSpec(specPath)).rejects.toThrow(/design\.type/);
  });

  it("throws SpecLoadError for malformed YAML", async () => {
    const specPath = path.join(tmpDir, "malformed.yaml");
    await writeFile(specPath, "metadata: [unterminated\n  nope: :::\n", "utf8");

    await expect(loadSpec(specPath)).rejects.toThrow(SpecLoadError);
    await expect(loadSpec(specPath)).rejects.toThrow(/Malformed YAML|Invalid spec/);
  });

  it("throws SpecLoadError when the file does not exist", async () => {
    const specPath = path.join(tmpDir, "does-not-exist.yaml");
    await expect(loadSpec(specPath)).rejects.toThrow(SpecLoadError);
    await expect(loadSpec(specPath)).rejects.toThrow(/Cannot read spec file/);
  });

  it("accepts a typed `metadata:` catch-all on profile levels (Bullet 2.2)", async () => {
    const specPath = path.join(tmpDir, "profile-metadata.yaml");
    const yaml = `metadata:
  id: x
  name: x
  description: x
  version: "0.1.0"
  author: x
  seed: 1
  framework_version: "0.1.0"
  harness:
    id: "pi"
    package: "@facet/harness-pi"
    version: "0.70.0"
environment:
  timeout_per_run_seconds: 60
  max_tokens_per_run: 1000
  max_total_cost_usd: 0.1
  workspace_strategy: git_worktree
varying_factors:
  - id: prompt_id
    description: x
    levels:
      - id: a
  - id: profile
    description: x
    levels:
      - id: default
        ref: "profiles/default"
        hash: "TBD"
        metadata:
          theme: spike
          expected_metric_buckets: [graph, rag]
  - id: model
    description: x
    levels:
      - id: m
        provider: openrouter
        model_id: "google/gemini-2.5-flash-lite"
scenarios:
  - id: s
    ref: "scenarios/s"
    hash: "TBD"
design:
  type: full_factorial
  repetitions: 1
  parallelism: 1
comparisons: []
metrics:
  trace:
    capture: [tool_calls]
  evaluator:
    layers:
      - id: correctness
        type: oracle_script
        script: oracle/run.sh
        pass_condition: "exit_code == 0"
  judge: null
analysis:
  type: none
  emit: [results_table_csv]
`;
    await writeFile(specPath, yaml, "utf8");

    const spec = await loadSpec(specPath);
    const profileFactor = spec.varying_factors.find((f) => f.id === "profile");
    expect(profileFactor).toBeDefined();
    if (profileFactor && profileFactor.id === "profile") {
      const lvl = profileFactor.levels[0]!;
      expect(lvl.metadata).toEqual({
        theme: "spike",
        expected_metric_buckets: ["graph", "rag"],
      });
    }
  });

  it("still rejects unknown top-level keys on a profile level (root stays strict)", async () => {
    const specPath = path.join(tmpDir, "profile-unknown-top.yaml");
    const yaml = `metadata:
  id: x
  name: x
  description: x
  version: "0.1.0"
  author: x
  seed: 1
  framework_version: "0.1.0"
  harness:
    id: "pi"
    package: "@facet/harness-pi"
    version: "0.70.0"
environment:
  timeout_per_run_seconds: 60
  max_tokens_per_run: 1000
  max_total_cost_usd: 0.1
  workspace_strategy: git_worktree
varying_factors:
  - id: prompt_id
    description: x
    levels:
      - id: a
  - id: profile
    description: x
    levels:
      - id: default
        ref: "profiles/default"
        hash: "TBD"
        unknown_field_at_top: 1
  - id: model
    description: x
    levels:
      - id: m
        provider: openrouter
        model_id: "google/gemini-2.5-flash-lite"
scenarios:
  - id: s
    ref: "scenarios/s"
    hash: "TBD"
design:
  type: full_factorial
  repetitions: 1
  parallelism: 1
comparisons: []
metrics:
  trace:
    capture: [tool_calls]
  evaluator:
    layers:
      - id: correctness
        type: oracle_script
        script: oracle/run.sh
        pass_condition: "exit_code == 0"
  judge: null
analysis:
  type: none
  emit: [results_table_csv]
`;
    await writeFile(specPath, yaml, "utf8");
    await expect(loadSpec(specPath)).rejects.toThrow(SpecLoadError);
    await expect(loadSpec(specPath)).rejects.toThrow(/unknown_field_at_top/);
  });

  // Bullet 15.3 — the legacy `pi_version` field is rejected by the
  // spec parser with `metadata-pi-version-removed-in-v1`, not silently
  // synthesized into `harness` like in the 13.2 back-compat path.
  it("rejects metadata.pi_version with metadata-pi-version-removed-in-v1", async () => {
    const specPath = path.join(tmpDir, "legacy-pi-version.yaml");
    const yaml = `metadata:
  id: legacy
  name: legacy
  description: ""
  version: "0.1.0"
  author: tester
  seed: 0
  framework_version: "0.1.0"
  pi_version: "0.70.0"
environment:
  timeout_per_run_seconds: 60
  max_tokens_per_run: 1000
  max_total_cost_usd: 0.1
  workspace_strategy: git_worktree
varying_factors: []
scenarios: []
design:
  type: full_factorial
  repetitions: 1
  parallelism: 1
comparisons: []
metrics:
  trace:
    capture: [tool_calls]
  evaluator:
    layers: []
  judge: null
analysis:
  type: none
  emit: [results_table_csv]
`;
    await writeFile(specPath, yaml, "utf8");
    await expect(loadSpec(specPath)).rejects.toThrow(SpecLoadError);
    await expect(loadSpec(specPath)).rejects.toThrow(
      /metadata-pi-version-removed-in-v1/,
    );
  });
});
