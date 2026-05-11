// Bullet 14.2 — `facet hash-profile <packagePath>` rehashes a profile
// package's `profileRoot` directory and writes the result into
// `package.json#facet.hash`. The script normalizes JSON layout
// (`JSON.stringify(obj, null, 2) + "\n"`) so the resulting `package.json`
// is reproducible across machines and CI.
//
// The hash is the same SHA-256-of-canonical-tree used everywhere else
// (`hashDirectory` from `../bundle/manifest.js`). Validators
// (`checkPresetCompatibility`) compare this value against the experiment
// spec's declared `hash`; the runner re-derives the live hash at run
// time and surfaces a mismatch as `preset-hash-mismatch`.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { hashDirectory } from "../bundle/manifest.js";

interface FacetBlock {
  profileRoot: string;
  harness: string;
  harnessVersionRange: string;
  hash?: string;
}

interface PackageJson {
  name?: string;
  version?: string;
  facet?: FacetBlock;
  [key: string]: unknown;
}

export async function hashProfileCommand(packagePath: string): Promise<void> {
  const packageRoot = path.resolve(packagePath);
  const pkgJsonPath = path.join(packageRoot, "package.json");
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`No package.json at ${pkgJsonPath}`);
  }
  const raw = await readFile(pkgJsonPath, "utf8");
  let parsed: PackageJson;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `package.json at ${pkgJsonPath} is not valid JSON: ${(error as Error).message}`,
    );
  }
  const facet = parsed.facet;
  if (facet === undefined || typeof facet.profileRoot !== "string") {
    throw new Error(
      `package.json at ${pkgJsonPath} is missing a facet.profileRoot block`,
    );
  }
  const profileAbs = path.resolve(packageRoot, facet.profileRoot);
  if (!existsSync(profileAbs)) {
    throw new Error(`profileRoot does not exist on disk: ${profileAbs}`);
  }
  const hash = await hashDirectory(profileAbs);
  parsed.facet = { ...facet, hash };
  await writeFile(pkgJsonPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  process.stdout.write(
    `Updated ${pkgJsonPath}\n  facet.profileRoot: ${facet.profileRoot}\n  facet.hash: ${hash}\n`,
  );
}
