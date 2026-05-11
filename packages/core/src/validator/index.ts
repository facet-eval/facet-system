import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { hashDirectory } from "../bundle/manifest.js";
import {
  ProfilePackageLoadError,
  checkPresetCompatibility,
  loadProfilePackage,
} from "../profile-package/loader.js";
import { loadExtensionsManifest } from "../runner/extensions.js";
import { loadToolEntries, resolveToolsForScenario } from "../runner/tools.js";
import { createExtensionsContributionRegistry } from "../registries/extensions-contribution-registry.js";
import { createMetricKindRegistry } from "../registries/metric-kind-registry.js";
import {
  HarnessLoadError,
  loadHarness,
} from "../harness-loader.js";

import {
  compareSemverParts,
  getInstalledFrameworkVersion,
} from "../runner/version.js";
import { ScenarioMetaSchema, type ExperimentSpec } from "../spec/schema.js";
import { isBinaryOnPath } from "./binaries.js";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
  // Defaults to "error". Warnings let the validator surface findings that
  // are non-fatal under the default policy (e.g. unknown but harmless YAML
  // keys) but still get printed to the user. `FACET_STRICT_SCHEMA=true`
  // promotes warnings to errors so CI can lock the schema for release.
  severity?: ValidationSeverity;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface ValidateOptions {
  readonly checkBinaries?: boolean;
  readonly pathEnv?: string | undefined;
  // Promote `severity: "warning"` issues to errors. When undefined, falls
  // back to `process.env.FACET_STRICT_SCHEMA === "true"` so CI / release
  // tooling can flip the policy via env var without re-plumbing options.
  readonly strictSchema?: boolean;
}

function isErrorIssue(issue: ValidationIssue): boolean {
  return (issue.severity ?? "error") === "error";
}

interface BinaryRequirement {
  readonly binary: string;
  readonly origin: string;
}

function isDirectory(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

export async function validateSpec(
  spec: ExperimentSpec,
  packageRoot: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const checkBinaries = options.checkBinaries ?? true;
  const pathEnv = "pathEnv" in options ? options.pathEnv : process.env.PATH;
  const strictSchema =
    options.strictSchema ?? process.env.FACET_STRICT_SCHEMA === "true";
  const scenarioBinaries: BinaryRequirement[] = [];

  // Bullet 16.3 — dynamically load the declared harness so the
  // validator (a) uses `adapter.version` for the harness-version
  // mismatch check below and (b) populates the contributions
  // registry from the harness's `register()` hook. A load failure
  // surfaces as a `harness-load-failed` validation issue — the
  // validator continues with whatever default registry state exists
  // so the rest of the run reports as much as possible.
  const contributionsRegistry = createExtensionsContributionRegistry();
  let installedHarnessVersion: string | undefined;
  try {
    const loaded = await loadHarness(
      spec.metadata.harness.package,
      packageRoot,
    );
    installedHarnessVersion = loaded.adapter.version;
    if (loaded.register !== undefined) {
      await loaded.register({
        metricKind: createMetricKindRegistry(),
        extensionsContribution: contributionsRegistry,
      });
    }
  } catch (e) {
    if (e instanceof HarnessLoadError) {
      issues.push({
        code: "harness-load-failed",
        message: `Could not load harness "${spec.metadata.harness.package}": ${e.message}`,
      });
    } else {
      throw e;
    }
  }

  // Phase 7 / Bullet 7.2: cross-check declared framework + Pi versions
  // against the installed packages.
  // Major mismatch → error. The spec was authored against an incompatible
  // framework / Pi; running it would silently produce noise.
  // Minor/patch mismatch → warning. Often safe but worth surfacing.
  // Unparseable on either side → warning. Cannot conclude either way.
  const installedFramework = getInstalledFrameworkVersion();
  const frameworkDiff = compareSemverParts(
    spec.metadata.framework_version,
    installedFramework,
  );
  if (frameworkDiff === "major") {
    issues.push({
      code: "framework-version-major-mismatch",
      message: `Spec declares framework_version "${spec.metadata.framework_version}" but installed FACET is "${installedFramework}" (major mismatch). Update the spec or install a compatible framework version.`,
    });
  } else if (frameworkDiff === "minor" || frameworkDiff === "patch") {
    issues.push({
      code: "framework-version-minor-mismatch",
      message: `Spec declares framework_version "${spec.metadata.framework_version}" but installed FACET is "${installedFramework}" (${frameworkDiff} mismatch).`,
      severity: "warning",
    });
  } else if (frameworkDiff === "unparseable") {
    issues.push({
      code: "framework-version-unparseable",
      message: `Could not compare framework_version "${spec.metadata.framework_version}" against installed "${installedFramework}".`,
      severity: "warning",
    });
  }

  // Bullet 13.2: cross-check the harness's declared version against the
  // installed adapter. The declared value comes from `metadata.harness
  // .version`; the back-compat `pi_version` is preserved only as the
  // value that synthesized the harness block (z.preprocess in
  // schema.ts) — readers should consult `metadata.harness` going
  // forward. Phase 13.x will pass the loaded HarnessAdapter here so the
  // installed version reads from `adapter.version` instead of the
  // node_modules walk.
  const declaredHarness = spec.metadata.harness.version;
  // Bullet 16.3 — installed adapter version comes from the loaded
  // harness above. The pre-16.3 implementation called Pi's
  // `getInstalledPiVersion()` directly. A load failure already
  // surfaced as `harness-load-failed`; here we treat the version as
  // "unknown" so the semver compare emits `harness-version-unparseable`
  // as a warning instead of throwing.
  const installedHarness = installedHarnessVersion ?? "unknown";
  const harnessDiff = compareSemverParts(declaredHarness, installedHarness);
  if (harnessDiff === "major") {
    issues.push({
      code: "harness-version-major-mismatch",
      message: `Spec declares harness "${spec.metadata.harness.id}@${declaredHarness}" but installed adapter version is "${installedHarness}" (major mismatch).`,
    });
  } else if (harnessDiff === "minor" || harnessDiff === "patch") {
    issues.push({
      code: "harness-version-minor-mismatch",
      message: `Spec declares harness "${spec.metadata.harness.id}@${declaredHarness}" but installed adapter version is "${installedHarness}" (${harnessDiff} mismatch).`,
      severity: "warning",
    });
  } else if (harnessDiff === "unparseable") {
    issues.push({
      code: "harness-version-unparseable",
      message: `Could not compare harness version "${declaredHarness}" against installed "${installedHarness}".`,
      severity: "warning",
    });
  }

  // Bullet 15.3 — the back-compat `pi_version` synthesis is gone. A
  // spec that still ships it fails the spec parser (z.object.strict)
  // before reaching the validator with an "Unrecognized key" error.
  // No validator code needed here; the parse-level rejection is the
  // user-facing message.

  let requiredPromptIds: string[] = [];
  let profileLevels: { id: string; ref: string; hash: string }[] = [];
  for (const factor of spec.varying_factors) {
    if (factor.type === "prompt_swap") {
      requiredPromptIds = factor.levels.map((l) => l.id);
    } else if (factor.type === "extension_select") {
      profileLevels = factor.levels.map((l) => ({
        id: l.id,
        ref: l.ref,
        hash: l.hash,
      }));
    }
  }

  for (const scenario of spec.scenarios) {
    const scenarioAbs = path.resolve(packageRoot, scenario.ref);
    if (!isDirectory(scenarioAbs)) {
      issues.push({
        code: "scenario-ref-missing",
        message: `Scenario "${scenario.id}" ref does not exist on disk: ${scenario.ref}`,
        path: scenarioAbs,
      });
      continue;
    }

    // Phase 7 / Bullet 7.3 — hash verification. `hash: "TBD"` is a soft
    // placeholder (warning + run continues; manifest records the post-hoc
    // hash). A non-TBD hash that does not match is a hard failure — the
    // spec was authored against a different scenario snapshot, and
    // running it would silently produce results tagged with the wrong
    // hash. Skip the hashing when the directory is missing (already
    // reported above).
    try {
      const actualHash = await hashDirectory(scenarioAbs);
      if (scenario.hash === "TBD") {
        issues.push({
          code: "scenario-hash-tbd",
          message: `Scenario "${scenario.id}" declares hash: "TBD" — run will proceed and manifest will record the post-hoc hash ${actualHash}. Update spec.yaml to lock the snapshot.`,
          severity: "warning",
          path: scenarioAbs,
        });
      } else if (scenario.hash !== actualHash) {
        issues.push({
          code: "scenario-hash-mismatch",
          message: `Scenario "${scenario.id}" hash mismatch: spec declares ${scenario.hash}, on-disk content hashes to ${actualHash}.`,
          path: scenarioAbs,
        });
      }
    } catch (e) {
      issues.push({
        code: "scenario-hash-unreadable",
        message: `Could not hash scenario "${scenario.id}": ${(e as Error).message}`,
        severity: "warning",
        path: scenarioAbs,
      });
    }

    const metaPath = path.join(scenarioAbs, "meta.yaml");
    if (!existsSync(metaPath)) {
      issues.push({
        code: "scenario-meta-missing",
        message: `Scenario "${scenario.id}" is missing meta.yaml`,
        path: metaPath,
      });
      continue;
    }

    let metaRaw: string;
    try {
      metaRaw = await readFile(metaPath, "utf8");
    } catch (e) {
      issues.push({
        code: "scenario-meta-unreadable",
        message: `Scenario "${scenario.id}" meta.yaml could not be read: ${(e as Error).message}`,
        path: metaPath,
      });
      continue;
    }

    let metaParsed: unknown;
    try {
      metaParsed = parseYaml(metaRaw);
    } catch (e) {
      issues.push({
        code: "scenario-meta-invalid-yaml",
        message: `Scenario "${scenario.id}" meta.yaml is not valid YAML: ${(e as Error).message}`,
        path: metaPath,
      });
      continue;
    }

    const meta = ScenarioMetaSchema.safeParse(metaParsed);
    if (!meta.success) {
      // Carve out a specific error for "missing or empty prompts:" so the
      // user sees a targeted message instead of a generic Zod dump.
      // Closes audit B-01: validator now agrees with the runner that a
      // scenario without prompts is rejected up-front, not crash at
      // facet-run time.
      const promptsIssue = meta.error.issues.find(
        (i) => i.path[0] === "prompts",
      );
      if (promptsIssue !== undefined) {
        issues.push({
          code: "scenario-prompts-empty",
          message: `Scenario "${scenario.id}" must declare at least one prompt in meta.yaml: ${promptsIssue.message}`,
          path: metaPath,
        });
      } else {
        issues.push({
          code: "scenario-meta-invalid",
          message: `Scenario "${scenario.id}" meta.yaml is invalid: ${meta.error.issues
            .map((i) => i.message)
            .join("; ")}`,
          path: metaPath,
        });
      }
      continue;
    }

    if (meta.data.requires_binaries !== undefined) {
      for (const bin of meta.data.requires_binaries) {
        scenarioBinaries.push({
          binary: bin,
          origin: `scenario ${scenario.id}`,
        });
      }
    }

    const declaredPrompts = meta.data.prompts;
    const declaredIds = new Set(declaredPrompts.map((p) => p.id));
    for (const required of requiredPromptIds) {
      if (!declaredIds.has(required)) {
        issues.push({
          code: "scenario-missing-prompt",
          message: `Scenario "${scenario.id}" does not declare prompt_id "${required}" required by the spec`,
          path: metaPath,
        });
      }
    }

    for (const declared of declaredPrompts) {
      const promptFile = path.join(scenarioAbs, declared.file);
      if (!existsSync(promptFile)) {
        issues.push({
          code: "scenario-prompt-file-missing",
          message: `Scenario "${scenario.id}" prompt "${declared.id}" file missing: ${declared.file}`,
          path: promptFile,
        });
      }
    }
  }

  // Resolve every profile's extensions manifest once so we can both surface
  // unknown-key warnings (always, regardless of `checkBinaries`) and feed
  // the binary preflight below. A profile whose ref does not exist is
  // already reported via `profile-ref-missing` and skipped here.
  //
  // Two ref shapes are supported (Bullet 14.1):
  //   - relative refs (`./`, `../`, `/`, `~/`) resolve against
  //     `packageRoot` exactly as in earlier phases;
  //   - npm-shaped refs (everything else) walk `node_modules` from
  //     `packageRoot` and read `package.json#facet` for the profile
  //     directory + harness compat metadata.
  const profileManifests = new Map<
    string,
    Awaited<ReturnType<typeof loadExtensionsManifest>>
  >();
  for (const level of profileLevels) {
    // Mirror the loader's classification: scoped (`@…`) or bare unscoped
    // package names are npm refs; everything else (`./foo`, `profiles/x`,
    // absolute paths) is treated as relative to packageRoot.
    const isNpmRef =
      level.ref.startsWith("@") ||
      (!level.ref.includes("/") && !level.ref.startsWith("."));
    const isRelative = !isNpmRef;
    let profileAbs: string;
    if (isRelative) {
      profileAbs = path.resolve(packageRoot, level.ref);
      if (!isDirectory(profileAbs)) {
        issues.push({
          code: "profile-ref-missing",
          message: `Profile level "${level.id}" ref does not exist on disk: ${level.ref}`,
          path: profileAbs,
        });
        continue;
      }
    } else {
      try {
        const preset = await loadProfilePackage(level.ref, packageRoot);
        profileAbs = preset.profilePath;
        const compatIssues = checkPresetCompatibility(
          preset,
          spec.metadata.harness.package,
          level.hash === "TBD" ? undefined : level.hash,
        );
        for (const issue of compatIssues) {
          issues.push({ code: issue.code, message: issue.message });
        }
      } catch (e) {
        if (e instanceof ProfilePackageLoadError) {
          issues.push({
            code: "preset-load-failed",
            message: `Profile level "${level.id}" preset "${level.ref}" failed to load: ${e.message}`,
          });
          continue;
        }
        throw e;
      }
    }

    // Phase 7 / Bullet 7.3 — same hash policy as scenarios above. Only
    // applied to relative refs: npm-shaped presets ship a manifest hash
    // that `checkPresetCompatibility` already verified above, and the
    // directory content is the publisher's responsibility, not the
    // experiment author's.
    if (isRelative) {
      try {
        const actualHash = await hashDirectory(profileAbs);
        if (level.hash === "TBD") {
          issues.push({
            code: "profile-hash-tbd",
            message: `Profile "${level.id}" declares hash: "TBD" — run will proceed and manifest will record the post-hoc hash ${actualHash}. Update spec.yaml to lock the snapshot.`,
            severity: "warning",
            path: profileAbs,
          });
        } else if (level.hash !== actualHash) {
          issues.push({
            code: "profile-hash-mismatch",
            message: `Profile "${level.id}" hash mismatch: spec declares ${level.hash}, on-disk content hashes to ${actualHash}.`,
            path: profileAbs,
          });
        }
      } catch (e) {
        issues.push({
          code: "profile-hash-unreadable",
          message: `Could not hash profile "${level.id}": ${(e as Error).message}`,
          severity: "warning",
          path: profileAbs,
        });
      }
    }

    // Phase 11 / Bullet 11.4 — F-14. When a profile declares any
    // per-scenario tool gate, surface a warning for spec scenarios that
    // end up with zero tools. Catches the case where an author added
    // gating but forgot to list a scenario. Tools-load failures are
    // surfaced separately by the runner; here we silently skip them
    // because the file may not exist on misconfigured profiles.
    try {
      const toolEntries = await loadToolEntries(profileAbs, level.id);
      const hasGate = toolEntries.some(
        (e) => e.appliesToScenarios !== undefined,
      );
      if (hasGate) {
        for (const scenario of spec.scenarios) {
          const resolved = resolveToolsForScenario(toolEntries, scenario.id);
          if (resolved.length === 0) {
            issues.push({
              code: "tools-scenario-not-covered",
              message: `Profile "${level.id}" has per-scenario tool gates but resolves to zero tools for scenario "${scenario.id}"`,
              severity: "warning",
              path: path.join(profileAbs, "tools.yaml"),
            });
          }
        }
      }
    } catch {
      // Tools-load error is reported by the runner at run time; skip here.
    }

    try {
      const manifest = await loadExtensionsManifest(
        profileAbs,
        level.id,
        packageRoot,
        (warning) => {
          issues.push({
            code: warning.code,
            message: warning.message,
            ...(warning.path !== undefined ? { path: warning.path } : {}),
            severity: "warning",
          });
        },
        contributionsRegistry,
      );
      profileManifests.set(level.id, manifest);

      // Phase 5 / Bullet 5.3: preflights for the universal `upfront_context`
      // hook. The Pi-specific `pinned-agents-empty` preflight moved to
      // harness-pi as a contribution preflight (Bullet 16.2) — iterated
      // below over every registered contribution.
      if (manifest !== undefined) {
        for (const item of manifest.upfrontContext) {
          // upfront-command-missing: the named command is not on PATH.
          if (!isBinaryOnPath(item.command, pathEnv)) {
            issues.push({
              code: "upfront-command-missing",
              message: `Profile "${level.id}" upfront_context declares command "${item.command}" which is not on PATH`,
              path: path.join(profileAbs, "extensions.yaml"),
            });
          }
          // upfront-script-missing: when the first arg looks like a
          // path-relative script (contains a "/"), check it exists
          // relative to the profile dir.
          const firstArg = item.args[0];
          if (typeof firstArg === "string" && firstArg.includes("/") && !firstArg.includes("$")) {
            const scriptAbs = path.resolve(profileAbs, firstArg);
            if (!existsSync(scriptAbs)) {
              issues.push({
                code: "upfront-script-missing",
                message: `Profile "${level.id}" upfront_context script does not exist: ${firstArg}`,
                path: scriptAbs,
              });
            }
          }
        }
        // Bullet 16.2 — every contribution that declared a `preflight`
        // hook runs here, against its own parsed value. The contribution
        // owns its issue codes (e.g. Pi's `pinned-agents-empty`), so the
        // core validator does not name any harness-specific key.
        for (const entry of contributionsRegistry.list()) {
          const contribution = entry.contribution;
          if (contribution.preflight === undefined) continue;
          const value = manifest.contributions[contribution.key];
          if (value === undefined) continue;
          const contributionIssues = contribution.preflight(value, {
            profileId: level.id,
            profilePath: profileAbs,
          });
          for (const ci of contributionIssues) {
            issues.push({
              code: ci.code,
              message: ci.message,
              ...(ci.path !== undefined ? { path: ci.path } : {}),
              ...(ci.severity !== undefined ? { severity: ci.severity } : {}),
            });
          }
        }
      }
    } catch (e) {
      issues.push({
        code: "profile-extensions-invalid",
        message: `Profile "${level.id}" extensions.yaml could not be loaded: ${(e as Error).message}`,
        path: path.join(profileAbs, "extensions.yaml"),
      });
    }
  }

  if (checkBinaries) {
    const requirements: BinaryRequirement[] = [...scenarioBinaries];
    const scenarioIds = spec.scenarios.map((s) => s.id);

    for (const level of profileLevels) {
      const manifest = profileManifests.get(level.id);
      if (manifest === undefined) continue;
      for (const bin of manifest.requiresBinaries) {
        requirements.push({ binary: bin, origin: `profile ${level.id}` });
      }
      for (const sid of scenarioIds) {
        const perScenario = manifest.requiresBinariesPerScenario[sid];
        if (perScenario !== undefined) {
          for (const bin of perScenario) {
            requirements.push({
              binary: bin,
              origin: `profile ${level.id}, scenario ${sid}`,
            });
          }
        }
        const lsBinary = manifest.languageServers[sid];
        if (lsBinary !== undefined) {
          requirements.push({
            binary: lsBinary,
            origin: `profile ${level.id}, scenario ${sid}`,
          });
        }
      }
    }

    const grouped = new Map<string, string[]>();
    for (const r of requirements) {
      const list = grouped.get(r.binary);
      if (list !== undefined) {
        if (!list.includes(r.origin)) list.push(r.origin);
      } else {
        grouped.set(r.binary, [r.origin]);
      }
    }

    const binariesSorted = Array.from(grouped.keys()).sort();
    for (const binary of binariesSorted) {
      if (!isBinaryOnPath(binary, pathEnv)) {
        const origins = grouped.get(binary) ?? [];
        issues.push({
          code: "binary-missing",
          message: `Required binary "${binary}" not found on PATH (${origins.join("; ")})`,
        });
      }
    }
  }

  // FACET_STRICT_SCHEMA / options.strictSchema = true → promote every
  // warning to an error. The original `severity` is dropped so downstream
  // tooling sees a uniform "this is a hard failure" signal in CI; the
  // human-readable code/message stay the same.
  const finalIssues: ValidationIssue[] = strictSchema
    ? issues.map((i) =>
        i.severity === "warning" ? { ...i, severity: "error" } : i,
      )
    : issues;
  return { ok: !finalIssues.some(isErrorIssue), issues: finalIssues };
}
