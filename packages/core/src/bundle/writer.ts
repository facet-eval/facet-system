import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringify as stringifyYaml } from "yaml";

import type { ExperimentSpec } from "../spec/schema.js";

export class BundleError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BundleError";
  }
}

export interface RunConfig {
  readonly runId: string;
  readonly promptId: string;
  readonly profileId: string;
  readonly modelLevelId: string;
  readonly provider: string;
  readonly modelId: string;
  readonly scenarioId: string;
  readonly repetition: number;
  // Per-run harness param overrides bound by `model_param` factors
  // (Phase 6 / F-58). Keyed by harness-param name (e.g. `temperature`).
  // No harness applies these today; the run records the requested values
  // in config.yaml regardless so a future facet-run replay can pick them
  // up. Documented in NOTES.md [Phase 6].
  readonly harnessParams?: Readonly<Record<string, unknown>>;
  // Seed propagation (Phase 7 / Bullet 7.4). `seed` is the spec-level
  // seed echoed verbatim so a reader of config.yaml sees the same value
  // the spec author chose. `derivedSeed` is `mixSeed(spec.seed, runId)`
  // — a deterministic per-run scalar that captures *intent* to vary
  // independently per run. No harness today consumes either; both are
  // recorded for traceability and a future replay.
  readonly seed?: number;
  readonly derivedSeed?: number;
}


export class BundleWriter {
  public readonly bundlePath: string;
  private initialized = false;

  constructor(bundlePath: string) {
    this.bundlePath = path.resolve(bundlePath);
  }

  async initBundle(specSourcePath: string, _spec: ExperimentSpec): Promise<void> {
    await mkdir(this.bundlePath, { recursive: true });
    await mkdir(path.join(this.bundlePath, "runs"), { recursive: true });
    const specRaw = await readFile(specSourcePath, "utf8");
    await writeFile(path.join(this.bundlePath, "spec.yaml"), specRaw, "utf8");
    this.initialized = true;
  }

  async initRun(runConfig: RunConfig): Promise<string> {
    this.ensureInit();
    const runDir = this.runDir(runConfig.runId);
    await mkdir(runDir, { recursive: true });
    const configRecord: Record<string, unknown> = {
      run_id: runConfig.runId,
      prompt_id: runConfig.promptId,
      profile: runConfig.profileId,
      model: runConfig.modelLevelId,
      provider: runConfig.provider,
      model_id: runConfig.modelId,
      scenario: runConfig.scenarioId,
      repetition: runConfig.repetition,
    };
    if (runConfig.harnessParams !== undefined) {
      configRecord.harness_params = runConfig.harnessParams;
    }
    if (runConfig.seed !== undefined) configRecord.seed = runConfig.seed;
    if (runConfig.derivedSeed !== undefined) {
      configRecord.derived_seed = runConfig.derivedSeed;
    }
    await writeFile(path.join(runDir, "config.yaml"), stringifyYaml(configRecord), "utf8");
    return runDir;
  }

  async writeRunArtifact(
    runId: string,
    filename: string,
    content: string | Uint8Array,
  ): Promise<void> {
    this.ensureInit();
    const runDir = this.runDir(runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, filename), content);
  }

  /**
   * Phase 10 / Bullet 10.5. Write the artifact to a sibling `.tmp` file
   * first, then `rename(2)` it into place. POSIX guarantees the rename
   * is atomic when both paths are on the same filesystem (which they
   * are — `.tmp` lives in the same `runs/<id>/` directory). Readers
   * therefore see either the prior contents (if any) or the new fully-
   * written contents, never a torn write.
   */
  async writeRunArtifactAtomic(
    runId: string,
    filename: string,
    content: string | Uint8Array,
  ): Promise<void> {
    this.ensureInit();
    const runDir = this.runDir(runId);
    await mkdir(runDir, { recursive: true });
    const finalPath = path.join(runDir, filename);
    const tmpPath = `${finalPath}.tmp`;
    await writeFile(tmpPath, content);
    await rename(tmpPath, finalPath);
  }

  /**
   * Phase 10 / Bullet 10.2 — F-47. Default bundle exclusions, applied
   * by basename. The pre-Phase-10 behavior only filtered `.git`; we now
   * also drop common heavy build artifacts that would otherwise bloat
   * the result bundle. A scenario can extend this set via
   * `meta.yaml.bundle_excludes` (passed in as `extraExcludes`).
   */
  async copyWorkspaceIntoRun(
    runId: string,
    workspacePath: string,
    extraExcludes: readonly string[] = [],
  ): Promise<void> {
    this.ensureInit();
    const dest = path.join(this.runDir(runId), "workspace");
    const denylist = new Set<string>([
      ".git",
      "node_modules",
      "__pycache__",
      "dist",
      ...extraExcludes,
    ]);
    await cp(workspacePath, dest, {
      recursive: true,
      errorOnExist: false,
      filter: (source) => !denylist.has(path.basename(source)),
    });
  }

  async finalizeRun(_runId: string): Promise<void> {
    this.ensureInit();
    // No-op in bullet 4; bullets 5-6 will add per-run post-processing here.
  }

  runDir(runId: string): string {
    return path.join(this.bundlePath, "runs", runId);
  }

  private ensureInit(): void {
    if (!this.initialized) {
      throw new BundleError(
        `BundleWriter not initialized; call initBundle first (bundlePath=${this.bundlePath})`,
      );
    }
  }
}
