// @facet/sdk — profile-package.ts
//
// Public contract for profile packages — npm packages that bundle a
// reusable profile (SYSTEM.md + tools.yaml + optional extensions.yaml,
// agents/, upfront/) under a declared directory and target a specific
// harness. The package's `package.json` declares a `facet` block that
// `loadProfilePackage` parses; the runner then treats the profile
// directory as if it lived locally inside the experiment package.

import { z } from "zod";

// On-disk shape of `package.json.facet`. The validator runs this against
// the parsed `package.json` of any preset referenced by an
// `extension_select` factor level whose `ref` resolves to an installed
// npm package.
// ts-prune-ignore-next
export const ProfilePackageManifestSchema = z
  .object({
    // Path (relative to the package root) to the profile directory.
    // Convention: "./profile". Contents follow the standard profile
    // layout (SYSTEM.md, tools.yaml, optional extensions.yaml, etc.).
    profileRoot: z.string().min(1),
    // npm package name of the harness this preset targets. The runner
    // verifies this matches the experiment spec's
    // `metadata.harness.package` and fails with
    // `preset-harness-mismatch` otherwise.
    harness: z.string().min(1),
    // Semver range of compatible harness versions. Validator emits
    // `preset-harness-version-out-of-range` (error) when the loaded
    // harness's `version` does not satisfy this range.
    harnessVersionRange: z.string().min(1),
    // Optional precomputed sha256 of the profile directory (after
    // canonical sorting). Set by the `facet-hash-profile` script at
    // publish time; the runner verifies it against the live directory
    // and records the resolved value in `manifest.provenance.profiles[]`.
    hash: z.string().min(1).optional(),
  })
  .strict();

// ts-prune-ignore-next
export type ProfilePackageManifest = z.infer<typeof ProfilePackageManifestSchema>;

// ts-prune-ignore-next
export interface ParsedProfilePackage {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageRoot: string;
  readonly profilePath: string;
  readonly manifest: ProfilePackageManifest;
}

// Convenience parser: validates the `facet` block in a parsed
// `package.json` and returns the typed manifest. The runner's
// loadProfilePackage is the production caller; tests use this directly.
// ts-prune-ignore-next
export function parseProfilePackageManifest(
  facetBlock: unknown,
): ProfilePackageManifest {
  return ProfilePackageManifestSchema.parse(facetBlock);
}
