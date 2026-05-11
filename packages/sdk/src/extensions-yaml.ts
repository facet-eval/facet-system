// @facet/sdk — extensions-yaml.ts
//
// Public contract for `extensions.yaml` sub-schemas contributed by harnesses
// and presets. The framework core declares the universal top-level keys
// (`extensions`, `upfront_context`, `requires_binaries`, `metrics`); a
// harness or preset can register additional top-level keys via
// `defineExtensionsContribution` and the spec parser composes them into
// the root ExtensionsYamlSchema at load time.
//
// This is the primary mechanism for a harness to add its own profile
// surface (Pi registers `pinned_agents`, `language_servers`, etc.) without
// the core ever naming those keys.

import type { ZodType } from "zod";

// Bullet 16.2 — validator-side preflight surface.
//
// A harness owns its own validator semantics for any sub-block it
// contributes: the framework core only knows how to parse the value
// against the contribution's `schema` and dispatch its `preflight`
// hook. The hook returns an array of validator issues; the core surfaces
// them under the same severity machinery as built-in checks.
// ts-prune-ignore-next
export interface ExtensionsContributionIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly severity?: "error" | "warning";
}

// ts-prune-ignore-next
export interface ExtensionsContributionPreflightContext {
  readonly profileId: string;
  // Absolute path to the resolved profile directory. Preflights that
  // need to check on-disk artifacts (e.g. Pi's "pinned-agents source_dir
  // contains no .md files") resolve their checks against this.
  readonly profilePath: string;
}

// ts-prune-ignore-next
export interface ExtensionsContribution<TValue = unknown> {
  // The top-level key under `extensions.yaml` this contribution owns.
  // E.g. "pinned_agents", "language_servers". Must be unique within the
  // active registry; duplicate registration is an error.
  readonly key: string;
  // Zod schema validating the value at that key. The framework runs this
  // when parsing `extensions.yaml`; failures surface as
  // `extensions-<key>-invalid` validator errors.
  readonly schema: ZodType<TValue>;
  // Whether the key is required when present on the root schema. Defaults
  // to false — most contributions are optional and only apply when a
  // profile opts in by declaring them.
  readonly required?: boolean;
  // Optional validate-time preflight. Called once per profile that
  // declares the contribution's key, with the parsed value + profile
  // context. Return an empty array when nothing to surface. Lets a
  // harness own its own validator semantics (Pi's "pinned-agents-empty"
  // moves here under Bullet 16.2) without any core code naming the
  // contribution's key.
  preflight?(
    value: TValue,
    context: ExtensionsContributionPreflightContext,
  ): readonly ExtensionsContributionIssue[];
}

// ts-prune-ignore-next
export function defineExtensionsContribution<TValue>(
  contribution: ExtensionsContribution<TValue>,
): ExtensionsContribution<TValue> {
  return contribution;
}
