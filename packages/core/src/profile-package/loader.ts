// Bullet 14.1 — profile-package loader.
//
// `loadProfilePackage(ref, contextDir)` resolves a reference (npm
// package name or relative path) to a `ParsedProfilePackage`. npm-style
// refs walk up node_modules from this module and read
// `package.json#facet` to discover the profile directory; relative refs
// (starting with `./`, `../`, `/`, or `~/`) skip the package lookup and
// treat the ref as a path relative to `contextDir`.
//
// The npm path is what makes a preset shippable: a third-party
// `@acme/preset-pi-haskell` lives in node_modules with a
// `package.json#facet = {profileRoot, harness, harnessVersionRange,
// hash?}` block, and the experiment spec references it by name.
//
// Validator-side checks (`preset-harness-mismatch`,
// `preset-hash-mismatch`) live elsewhere; this loader produces a
// `ParsedProfilePackage` with the raw manifest so callers can run them.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseProfilePackageManifest,
  type ParsedProfilePackage,
  type ProfilePackageManifest,
} from "@facet/sdk/profile-package";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ts-prune-ignore-next
export class ProfilePackageLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProfilePackageLoadError";
  }
}

// A ref is an npm package reference iff it starts with `@` (scoped) or
// looks like an unscoped bare package name (no slash and no path
// markers). Everything else — including bare directory refs like
// `profiles/default` that pre-date Phase 14 — is treated as a path
// relative to `contextDir`. This preserves legacy behavior while
// admitting `@facet/preset-pi-*` as the only npm-style refs in practice.
function isRelativeRef(ref: string): boolean {
  if (ref.startsWith("@")) return false;
  if (
    ref.startsWith("./") ||
    ref.startsWith("../") ||
    ref.startsWith("/") ||
    ref.startsWith("~/")
  ) {
    return true;
  }
  // Bare names without `/` are npm packages (`my-preset`). Anything with
  // a `/` that isn't scoped (`my-pkg/sub`) is also assumed to be a path;
  // npm packages with slashes are always scoped under the FACET ecosystem.
  return ref.includes("/");
}

// Walk up `node_modules` chains looking for the package. Tries `startDir`
// first (the experiment package directory or test tmpdir) and falls back
// to `HERE` (this module's location). The dual walk handles two layouts:
//   - production pnpm workspace where the experiment package sits inside
//     a hoisted tree and `HERE` finds the install,
//   - tests / standalone experiments where the experiment package brings
//     its own `node_modules` and `HERE` would miss it.
function findInstalledPackageRoot(
  pkg: string,
  startDir: string,
): string | undefined {
  for (const origin of [startDir, HERE]) {
    let dir = origin;
    while (true) {
      const candidate = path.join(dir, "node_modules", pkg);
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

async function readPackageJson(packageRoot: string): Promise<{
  readonly name?: unknown;
  readonly version?: unknown;
  readonly facet?: unknown;
}> {
  const file = path.join(packageRoot, "package.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    throw new ProfilePackageLoadError(
      `Cannot read package.json at ${file}: ${(error as Error).message}`,
      { cause: error },
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ProfilePackageLoadError(
      `package.json at ${file} is not valid JSON: ${(error as Error).message}`,
      { cause: error },
    );
  }
}

// ts-prune-ignore-next
export async function loadProfilePackage(
  ref: string,
  contextDir: string,
): Promise<ParsedProfilePackage> {
  if (isRelativeRef(ref)) {
    // Relative refs keep the legacy behavior: treat `ref` as a path
    // relative to the experiment package's contextDir. No
    // package.json#facet to consult — the contextDir's own
    // package.json (when present) supplies the version stamp.
    const profilePath = path.resolve(contextDir, ref);
    if (!existsSync(profilePath)) {
      throw new ProfilePackageLoadError(
        `Relative profile ref "${ref}" resolves to "${profilePath}" which does not exist.`,
      );
    }
    let packageName = "(relative)";
    let packageVersion = "0.0.0";
    const contextPkg = path.join(contextDir, "package.json");
    if (existsSync(contextPkg)) {
      const parsed = await readPackageJson(contextDir);
      if (typeof parsed.name === "string") packageName = parsed.name;
      if (typeof parsed.version === "string") packageVersion = parsed.version;
    }
    return {
      packageName,
      packageVersion,
      packageRoot: contextDir,
      profilePath,
      manifest: {
        profileRoot: path.relative(contextDir, profilePath) || ".",
        harness: "(relative-skip-check)",
        harnessVersionRange: "*",
      },
    };
  }

  const packageRoot = findInstalledPackageRoot(ref, contextDir);
  if (packageRoot === undefined) {
    throw new ProfilePackageLoadError(
      `Profile package "${ref}" is not installed. Run \`pnpm add ${ref}\` in the experiment workspace before validating or running.`,
    );
  }
  const pkgJson = await readPackageJson(packageRoot);
  if (pkgJson.facet === undefined) {
    throw new ProfilePackageLoadError(
      `Profile package "${ref}" has no \`facet\` block in its package.json. Profile packages must declare \`facet: {profileRoot, harness, harnessVersionRange}\` so the runner can resolve the profile directory.`,
    );
  }
  let manifest: ProfilePackageManifest;
  try {
    manifest = parseProfilePackageManifest(pkgJson.facet);
  } catch (error) {
    throw new ProfilePackageLoadError(
      `Profile package "${ref}" has an invalid \`facet\` block: ${(error as Error).message}`,
      { cause: error },
    );
  }
  const profilePath = path.resolve(packageRoot, manifest.profileRoot);
  if (!existsSync(profilePath)) {
    throw new ProfilePackageLoadError(
      `Profile package "${ref}" declares profileRoot "${manifest.profileRoot}" but the resolved path "${profilePath}" does not exist.`,
    );
  }
  const packageName = typeof pkgJson.name === "string" ? pkgJson.name : ref;
  const packageVersion =
    typeof pkgJson.version === "string" ? pkgJson.version : "0.0.0";
  return {
    packageName,
    packageVersion,
    packageRoot,
    profilePath,
    manifest,
  };
}

// Validator-side helper: compares a loaded ParsedProfilePackage against
// the experiment spec's `metadata.harness.package` and `hash` declared
// on the factor level. Returns an array of validation issue codes; the
// caller is responsible for surfacing them as warnings vs. errors.
// ts-prune-ignore-next
export interface PresetCompatibilityIssue {
  readonly code: "preset-harness-mismatch" | "preset-hash-mismatch";
  readonly message: string;
}

// ts-prune-ignore-next
export function checkPresetCompatibility(
  preset: ParsedProfilePackage,
  expectedHarnessPackage: string,
  declaredHash: string | undefined,
): PresetCompatibilityIssue[] {
  const issues: PresetCompatibilityIssue[] = [];
  // Skip checks for relative refs — they bypass the manifest.
  if (preset.manifest.harness === "(relative-skip-check)") {
    return issues;
  }
  if (preset.manifest.harness !== expectedHarnessPackage) {
    issues.push({
      code: "preset-harness-mismatch",
      message: `Profile preset "${preset.packageName}" targets harness "${preset.manifest.harness}" but the experiment declares "${expectedHarnessPackage}".`,
    });
  }
  if (
    declaredHash !== undefined &&
    declaredHash !== "TBD" &&
    preset.manifest.hash !== undefined &&
    preset.manifest.hash !== declaredHash
  ) {
    issues.push({
      code: "preset-hash-mismatch",
      message: `Profile preset "${preset.packageName}" has hash "${preset.manifest.hash}" but the experiment spec declares "${declaredHash}". Re-run \`facet-hash-profile\` after publishing.`,
    });
  }
  return issues;
}
