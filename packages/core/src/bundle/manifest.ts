import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { flattenLayer2, type Layer2Metrics } from "../evaluator/layer2.js";
import { loadProfilePackage } from "../profile-package/loader.js";

import {
  getInstalledFrameworkVersion,
  gitProvenance,
} from "../runner/version.js";
import type { ExperimentSpec } from "../spec/schema.js";

import type { RunConfig } from "./writer.js";

export class ManifestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ManifestError";
  }
}

export type RunStatus =
  | "completed_passed"
  | "partially_completed"
  | "completed_failed"
  | "timeout"
  | "error";

export interface MatrixRunReport {
  readonly runConfig: RunConfig;
  readonly status: RunStatus;
  readonly durationMs?: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly tokensTotal?: number;
  readonly costUsd?: number;
  readonly clarificationRequestsCount?: number;
  readonly tasksPassed?: number;
  readonly tasksTotal?: number;
  readonly regressionTestsPassed?: number;
  readonly regressionTestsTotal?: number;
  // Full Layer2Metrics passed through. The manifest writer flattens
  // profile_metrics to top-level keys via `flattenLayer2` so on-disk
  // YAML stays a uniform record per run.
  readonly layer2?: Layer2Metrics;
  readonly error?: { readonly name: string; readonly message: string };
}

export interface MatrixRunResults {
  readonly packageRoot: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly reports: readonly MatrixRunReport[];
  // Bullet 16.3 — the loaded HarnessAdapter's `version`. Source of
  // truth for `provenance.pi.version`. Previously read from
  // `getInstalledPiVersion()` (a Pi-specific node_modules walk);
  // sourcing it from the loaded adapter makes the provenance flow
  // harness-agnostic.
  readonly installedHarnessVersion?: string;
}

const IGNORED_DIR_NAMES = new Set([".git", "node_modules"]);

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIR_NAMES.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const content = await readFile(filePath);
  hash.update(content);
  return `sha256:${hash.digest("hex")}`;
}

export async function hashDirectory(dirPath: string): Promise<string> {
  const absolute = path.resolve(dirPath);
  const stats = await stat(absolute).catch((error) => {
    throw new ManifestError(
      `Cannot hash directory "${dirPath}": ${(error as Error).message}`,
      { cause: error },
    );
  });
  if (!stats.isDirectory()) {
    throw new ManifestError(`Not a directory: ${dirPath}`);
  }
  const files = await listFilesRecursive(absolute);
  const hash = createHash("sha256");
  for (const file of files) {
    const rel = path.relative(absolute, file).split(path.sep).join("/");
    hash.update(rel);
    hash.update("\0");
    const content = await readFile(file);
    hash.update(content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function formatIso(date: Date): string {
  return new Date(date.getTime()).toISOString();
}

interface ScenarioManifest {
  id: string;
  ref: string;
  hash: string;
}

interface ProfileManifest {
  id: string;
  ref: string;
  hash: string;
  // Bullet 14.2 — npm-style profile packages emit their `package.json`
  // identity here so a replay reader can trace a bundle back to the
  // exact preset version that produced it. Undefined for relative
  // bare-path refs (pre-Phase-14 examples).
  package_name?: string;
  package_version?: string;
  facet_hash?: string;
  resolved_path?: string;
}

interface RunManifest {
  run_id: string;
  prompt_id: string;
  profile: string;
  model: string;
  scenario: string;
  repetition: number;
  status: RunStatus;
  duration_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  tasks_passed?: number;
  tasks_total?: number;
  regression_tests_passed?: number;
  regression_tests_total?: number;
  // Open record (Phase 4). Static framework-metric keys are always
  // present when populated; profile-declared keys vary per run's profile.
  // Reorders are not breaking — readers must look up by key, not
  // position.
  layer2?: Record<string, unknown>;
  error?: { name: string; message: string };
}

// Phase 7 / Bullet 7.5 — provenance block. Nested under a top-level
// `provenance:` key. `framework_version` and `pi_version` stay echoed at
// the manifest root for back-compat with the pre-Phase-7 reader.
export interface ProvenanceBlock {
  framework: {
    version: string;
    declared_version: string;
    git_commit: string;
    git_dirty: boolean;
  };
  pi: { version: string; declared_version: string };
  runtime: {
    node_version: string;
    platform: string;
    arch: string;
    hostname: string;
  };
  spec: { seed: number; started_at: string; finished_at: string };
}

export interface ManifestDocument {
  framework_version: string;
  pi_version: string;
  spec_id: string;
  created_at: string;
  finished_at: string;
  spec: { path: string; hash: string; normalized_path?: string; normalized_hash?: string };
  scenarios: ScenarioManifest[];
  profiles: ProfileManifest[];
  runs: RunManifest[];
  // Phase 10 / Bullet 10.3 — F-48. Always-on per-run artifact hashes.
  // Keyed by bundle-relative path (e.g. "runs/run-0001/metrics.json").
  // Includes every well-known per-run artifact (config.yaml, summary.json,
  // tests.json, metrics.json, trace.jsonl) that exists post-run. A
  // replay reader can verify a bundle has not been tampered with by
  // re-hashing each file and comparing.
  outputs: Record<string, string>;
  provenance: ProvenanceBlock;
}

/**
 * Walk a value and produce a stable representation by sorting object
 * keys alphabetically. Arrays preserve order (positional data). Used to
 * normalize the spec before hashing so insignificant key reorderings
 * inside the YAML do not invalidate the normalized hash.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = canonicalize(v);
    return out;
  }
  return value;
}

async function buildRuns(reports: readonly MatrixRunReport[]): Promise<RunManifest[]> {
  return reports.map((r) => {
    const entry: RunManifest = {
      run_id: r.runConfig.runId,
      prompt_id: r.runConfig.promptId,
      profile: r.runConfig.profileId,
      model: r.runConfig.modelLevelId,
      scenario: r.runConfig.scenarioId,
      repetition: r.runConfig.repetition,
      status: r.status,
    };
    if (r.durationMs !== undefined) entry.duration_ms = r.durationMs;
    if (r.tokensIn !== undefined) entry.tokens_in = r.tokensIn;
    if (r.tokensOut !== undefined) entry.tokens_out = r.tokensOut;
    if (r.costUsd !== undefined) entry.cost_usd = r.costUsd;
    if (r.tasksPassed !== undefined) entry.tasks_passed = r.tasksPassed;
    if (r.tasksTotal !== undefined) entry.tasks_total = r.tasksTotal;
    if (r.regressionTestsPassed !== undefined) {
      entry.regression_tests_passed = r.regressionTestsPassed;
    }
    if (r.regressionTestsTotal !== undefined) {
      entry.regression_tests_total = r.regressionTestsTotal;
    }
    if (r.layer2 !== undefined) {
      // Flatten profile_metrics to top-level keys so the on-disk YAML
      // is shape-uniform with what metrics.json already serializes
      // (Phase 4 / architecture doc §R1).
      entry.layer2 = flattenLayer2(r.layer2);
    }
    if (r.error !== undefined) entry.error = { name: r.error.name, message: r.error.message };
    return entry;
  });
}

export async function writeManifest(
  bundlePath: string,
  spec: ExperimentSpec,
  runResults: MatrixRunResults,
): Promise<ManifestDocument> {
  const absoluteBundle = path.resolve(bundlePath);
  const specInBundle = path.join(absoluteBundle, "spec.yaml");
  const specHash = await hashFile(specInBundle);

  // Phase 7 / Bullet 7.5 — emit `spec.normalized.yaml` as the executable
  // contract. Byte-for-byte spec.yaml stays alongside it; the normalized
  // hash is the version a replay tool should match against.
  const specRaw = await readFile(specInBundle, "utf8");
  const specParsed = parseYaml(specRaw) as unknown;
  const normalized = stringifyYaml(canonicalize(specParsed), { sortMapEntries: true });
  const normalizedPath = path.join(absoluteBundle, "spec.normalized.yaml");
  await writeFile(normalizedPath, normalized, "utf8");
  const normalizedHash = await hashFile(normalizedPath);

  const scenarios: ScenarioManifest[] = [];
  for (const scenario of spec.scenarios) {
    const scenarioAbs = path.resolve(runResults.packageRoot, scenario.ref);
    const hash = await hashDirectory(scenarioAbs);
    scenarios.push({ id: scenario.id, ref: scenario.ref, hash });
  }

  const profileEntries: ProfileManifest[] = [];
  for (const factor of spec.varying_factors) {
    if (factor.type !== "extension_select") continue;
    for (const level of factor.levels) {
      // Bullet 14.2 — npm-style refs route through `loadProfilePackage`
      // so the on-disk hash is taken against the resolved
      // `profileRoot` inside `node_modules` AND the `package.json`
      // identity travels into provenance. Relative refs stay on the
      // legacy path: `packageRoot` + `ref`, hashed in place.
      const isNpmRef =
        level.ref.startsWith("@") ||
        (!level.ref.includes("/") && !level.ref.startsWith("."));
      if (isNpmRef) {
        const preset = await loadProfilePackage(level.ref, runResults.packageRoot);
        const hash = await hashDirectory(preset.profilePath);
        const entry: ProfileManifest = {
          id: level.id,
          ref: level.ref,
          hash,
          package_name: preset.packageName,
          package_version: preset.packageVersion,
          resolved_path: preset.profilePath,
        };
        if (preset.manifest.hash !== undefined) {
          entry.facet_hash = preset.manifest.hash;
        }
        profileEntries.push(entry);
      } else {
        const profileAbs = path.resolve(runResults.packageRoot, level.ref);
        const hash = await hashDirectory(profileAbs);
        profileEntries.push({ id: level.id, ref: level.ref, hash });
      }
    }
  }

  const runs = await buildRuns(runResults.reports);

  // Phase 10 / Bullet 10.3 — F-48. Walk every existing per-run artifact
  // and record its sha256. Files that don't exist (e.g. metrics.json on
  // a run that crashed pre-evaluation) are skipped silently — the
  // `runs[].error` field already documents the crash.
  const PER_RUN_ARTIFACTS = [
    "config.yaml",
    "summary.json",
    "tests.json",
    "metrics.json",
    "trace.jsonl",
  ] as const;
  const outputs: Record<string, string> = {};
  for (const run of runs) {
    for (const artifact of PER_RUN_ARTIFACTS) {
      const abs = path.join(absoluteBundle, "runs", run.run_id, artifact);
      const rel = `runs/${run.run_id}/${artifact}`;
      try {
        outputs[rel] = await hashFile(abs);
      } catch {
        // ENOENT or read error — skip. A reader sees the absence as
        // "this run did not produce that artifact".
      }
    }
  }

  const installedFramework = getInstalledFrameworkVersion();
  // Bullet 16.3 — provenance reads `installedHarnessVersion` from the
  // loaded adapter (threaded through `MatrixRunResults`). Pre-16.3
  // this was a Pi-specific node_modules walk via
  // `getInstalledPiVersion()`. Callers that did not supply the value
  // (legacy tests + pre-16.3 entrypoints) get `"unknown"` so the
  // provenance block stays populated rather than crashing.
  const installedPi = runResults.installedHarnessVersion ?? "unknown";
  const git = gitProvenance(runResults.packageRoot);
  const provenance: ProvenanceBlock = {
    framework: {
      version: installedFramework,
      declared_version: spec.metadata.framework_version,
      git_commit: git.commit,
      git_dirty: git.dirty,
    },
    // Bullet 13.2: provenance.pi keeps the field name for back-compat
    // readers; declared_version reads from spec.metadata.harness now
    // that the pi_version shim is gone (Bullet 15.3). Phase 13.x may
    // rename this to `provenance.harness` once consumers are migrated.
    pi: {
      version: installedPi,
      declared_version: spec.metadata.harness.version,
    },
    runtime: {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
    },
    spec: {
      seed: spec.metadata.seed,
      started_at: formatIso(runResults.startedAt),
      finished_at: formatIso(runResults.finishedAt),
    },
  };

  const doc: ManifestDocument = {
    framework_version: spec.metadata.framework_version,
    pi_version: spec.metadata.harness.version,
    spec_id: spec.metadata.id,
    created_at: formatIso(runResults.startedAt),
    finished_at: formatIso(runResults.finishedAt),
    spec: {
      path: "spec.yaml",
      hash: specHash,
      normalized_path: "spec.normalized.yaml",
      normalized_hash: normalizedHash,
    },
    scenarios,
    profiles: profileEntries,
    runs,
    outputs,
    provenance,
  };

  const yamlText = stringifyYaml(doc);
  await writeFile(path.join(absoluteBundle, "manifest.yaml"), yamlText, "utf8");
  return doc;
}
