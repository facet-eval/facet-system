import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type { ExtensionsContribution } from "@facet/sdk/extensions-yaml";

import type { ExtensionsContributionRegistry } from "../registries/extensions-contribution-registry.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function findInstalledPackageRoot(pkg: string): string | undefined {
  let dir = HERE;
  while (true) {
    const candidate = path.join(dir, "node_modules", pkg);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export class ExtensionsLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ExtensionsLoadError";
  }
}

export interface ExtensionsWarning {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

// Schema strictness policy (Bullet 2.2 / architecture doc §R4):
//
// - Root schemas (`ExtensionsYamlSchema`, `ConstraintsSchema`) are
//   `.passthrough()` so profile authors can declare new top-level keys
//   (e.g. R1's `metrics:` block, R2's `pinned_agents:` block) without
//   editing this file. Unknown top-level keys are surfaced as warnings
//   via the `onWarning` callback in `loadExtensionsManifest` — typos
//   ship silently unless `FACET_STRICT_SCHEMA=true` promotes them.
// - Inner sub-schemas (`ExtensionEntrySchema`, `UpfrontContextItemSchema`)
//   are `.strict()` so a typo *inside* a known field (e.g.
//   `versoin: "1.0"` in an extension entry) still fails the load.
// - The `KNOWN_EXTENSIONS_KEYS` allowlist below is informational and is
//   what the runtime warning compares against. Add a key here once it is
//   intentional in order to suppress the warning.

const ExtensionEntrySchema = z
  .object({
    package: z.string().min(1),
    version: z.string().min(1),
    entry: z.string().min(1),
    applies_to_scenarios: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

// Generic upfront-context entry (Bullet 5.1 / architecture doc §R2). The
// runner exec's `command` with `args`, wraps stdout in a fenced block
// under `header`, and concatenates blocks. ${WORKSPACE} in `cwd` and any
// arg is substituted with the run's workspace path. The closed
// substitution-variable set is documented in upfront-context.ts JSDoc;
// adding a third placeholder requires a deliberate framework change.
const UpfrontContextItemSchema = z
  .object({
    applies_to_scenarios: z.array(z.string().min(1)).min(1),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().default("${WORKSPACE}"),
    timeout_ms: z.number().int().positive().optional(),
    header: z.string().min(1),
    notes: z.string().optional(),
  })
  .strict();

// Bullet 16.2 — `pinned_agents` and `language_servers` sub-schemas
// moved to `packages/harness-pi/src/extensions-contributions/`. The
// strings no longer appear in core source. The registry-driven
// `loadExtensionsManifest` below composes the root schema from the
// contributions the active harness registered.

const ConstraintsSchema = z
  .object({
    // Phase 5 removed the typed field. Old YAMLs may still set
    // `force_subagent_model_to_run_model`; passthrough lets them parse
    // (with the unknown-key validator warning) but the field has no
    // effect — `pinned_agents:` is the new trigger.
  })
  .passthrough();

// Bullet 13.3 — open metric-rule envelope. The previously closed
// discriminated union over Pi-specific kinds moved with the handlers
// to the harness adapter package. The envelope keeps `{ id, kind }`
// as the universal shape; per-kind config is validated by the
// handler's `configSchema` at dispatch time
// (`runMetricKindsOverEvents`). A spec that references a kind the
// active harness doesn't register fails fast at dispatch with a
// "No metric-kind handler registered for kind …" error.
const MetricRuleSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
  })
  .passthrough();

const ToolOwnerEntrySchema = z
  .object({
    name: z.string().min(1),
    owner: z.string().min(1),
  })
  .strict();

// Bullet 16.2 — universal root keys only. The harness-contributed
// keys (Pi's `pinned_agents`, `language_servers`) are added on top
// dynamically by `composeExtensionsYamlSchema` below when the runner
// passes a non-empty contributions registry. `requires_binaries`
// stays universal — every harness can declare what binaries its
// profile needs on PATH; the preflight is in the validator, not
// Pi-specific.
const UNIVERSAL_KNOWN_KEYS = [
  "extensions",
  "upfront_context",
  "constraints",
  "requires_binaries",
  "requires_binaries_per_scenario",
  "metrics",
  "tool_owner",
] as const;

const baseExtensionsYamlShape = {
  extensions: z.array(ExtensionEntrySchema).min(1).optional(),
  upfront_context: z.array(UpfrontContextItemSchema).optional(),
  constraints: ConstraintsSchema.optional(),
  requires_binaries: z.array(z.string().min(1)).min(1).optional(),
  requires_binaries_per_scenario: z
    .record(z.string().min(1), z.array(z.string().min(1)).min(1))
    .optional(),
  metrics: z.array(MetricRuleSchema).min(1).optional(),
  // Optional informational map between tool names and the profile that
  // owns them. Used today only for validator self-consistency checks
  // (warn when the same tool appears in multiple profiles' tool_owner
  // blocks or contradicts the profile's metrics rules). Layer-2 derives
  // metrics from the rules block; the framework no longer keeps a
  // hardcoded tool-to-owner registry.
  tool_owner: z.array(ToolOwnerEntrySchema).min(1).optional(),
} as const;

// Built with `composeExtensionsYamlSchema(contributions)` per call so
// the per-call known-keys allowlist used by the unknown-key warning
// includes whatever the harness contributed. The pre-Bullet-16.2
// `KNOWN_EXTENSIONS_KEYS` export is gone; production callers and tests
// derive the list from the registry now.

export interface ResolvedExtension {
  readonly package: string;
  readonly version: string;
  readonly entry: string;
  readonly resolvedPath: string;
  readonly appliesToScenarios?: readonly string[];
}

export interface UpfrontContextItem {
  readonly appliesToScenarios: readonly string[];
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly header: string;
  readonly notes?: string;
}

// Pi-specific shape kept as a structural type the runner reads from
// `manifest.pinnedAgents` (still typed for back-compat with agent-pin.ts
// + the validator preflight glue). The values are populated from the
// `pinned_agents` extensions-contribution registered by harness-pi;
// nothing in core's source knows the key string.
export interface PinnedAgentsConfig {
  readonly sourceDir: string;
  readonly modelPlaceholder: string;
  readonly inheritUserModelsJson: boolean;
}

export type MetricRule = z.infer<typeof MetricRuleSchema>;

export interface ExtensionsManifest {
  readonly extensions: readonly ResolvedExtension[];
  readonly upfrontContext: readonly UpfrontContextItem[];
  readonly requiresBinaries: readonly string[];
  readonly requiresBinariesPerScenario: Readonly<
    Record<string, readonly string[]>
  >;
  // Pi-only convenience field populated from the `language_servers`
  // extensions-contribution. Empty record when the active harness did
  // not register the contribution or the profile did not declare the
  // key.
  readonly languageServers: Readonly<Record<string, string>>;
  // Profile-declared metric rules (Bullet 4.1). Empty when the profile
  // declines to declare any — the framework's static metric set still
  // applies in that case.
  readonly metricRules: readonly MetricRule[];
  // Optional self-consistency map: tool name → owner label. Validator
  // warns on duplicates / contradictions; layer-2 ignores this.
  readonly toolOwners: Readonly<Record<string, string>>;
  // Pi-only convenience field populated from the `pinned_agents`
  // extensions-contribution. Undefined when the active harness did
  // not register the contribution or the profile did not declare the
  // key.
  readonly pinnedAgents: PinnedAgentsConfig | undefined;
  // Bullet 16.2 — every contribution's parsed value, keyed by the
  // contribution's `key`. Today only the two Pi contributions land
  // here; future harnesses add more. The convenience fields above are
  // adapter shims over this map for the in-tree callers (agent-pin,
  // validator preflight glue).
  readonly contributions: Readonly<Record<string, unknown>>;
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}

export function resolveExtensionPath(
  pkg: string,
  entry: string,
  packageRoot: string,
): string {
  // Walk up the node_modules chain from this module's location to find where
  // <pkg> is actually installed. Under pnpm (and most monorepo setups) the
  // experiment package directory has no node_modules of its own — everything
  // lives at the repo root. The legacy <packageRoot>/node_modules/<pkg>/<entry>
  // form is kept as a fallback so test fixtures that stand up their own
  // tmpDir/node_modules tree continue to work.
  const installed = findInstalledPackageRoot(pkg);
  if (installed !== undefined) {
    return path.resolve(installed, entry);
  }
  return path.resolve(packageRoot, "node_modules", pkg, entry);
}

// Compose the root extensions.yaml schema from the universal keys plus
// every contributed key the active harness registered. Each contribution
// adds `[key]: contribution.schema.optional()` and its key joins the
// `KNOWN_EXTENSIONS_KEYS` allowlist used by the unknown-key warning.
function composeExtensionsYamlSchema(
  contributions: readonly ExtensionsContribution[],
): { readonly schema: z.ZodTypeAny; readonly knownKeys: readonly string[] } {
  const shape: Record<string, z.ZodTypeAny> = { ...baseExtensionsYamlShape };
  const knownKeys: string[] = [...UNIVERSAL_KNOWN_KEYS];
  for (const contribution of contributions) {
    shape[contribution.key] = contribution.required
      ? contribution.schema
      : contribution.schema.optional();
    if (!knownKeys.includes(contribution.key)) knownKeys.push(contribution.key);
  }
  return { schema: z.object(shape).passthrough(), knownKeys };
}

function listContributions(
  registry: ExtensionsContributionRegistry | undefined,
): readonly ExtensionsContribution[] {
  if (registry === undefined) return [];
  return registry.list().map((entry) => entry.contribution);
}

// Adapter shim: read the legacy typed `pinnedAgents` field from the
// `pinned_agents` contribution's parsed value. Harness-pi'\''s
// `pinnedAgentsContribution.schema` produces the exact shape consumed
// by `agent-pin.ts`; the field is undefined when no contribution
// registered the key or the profile did not declare it.
function pinnedAgentsFromContributions(
  contributionValues: Readonly<Record<string, unknown>>,
): PinnedAgentsConfig | undefined {
  const value = contributionValues["pinned_agents"];
  if (value === undefined || value === null || typeof value !== "object") {
    return undefined;
  }
  const v = value as {
    source_dir?: unknown;
    model_placeholder?: unknown;
    inherit_user_models_json?: unknown;
  };
  if (
    typeof v.source_dir !== "string" ||
    typeof v.model_placeholder !== "string" ||
    typeof v.inherit_user_models_json !== "boolean"
  ) {
    return undefined;
  }
  return {
    sourceDir: v.source_dir,
    modelPlaceholder: v.model_placeholder,
    inheritUserModelsJson: v.inherit_user_models_json,
  };
}

// Adapter shim: read the legacy `languageServers` map from the
// `language_servers` contribution's parsed value. Returns an empty
// record when nothing was registered/declared.
function languageServersFromContributions(
  contributionValues: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const value = contributionValues["language_servers"];
  if (value === undefined || value === null || typeof value !== "object") {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export async function loadExtensionsManifest(
  profilePath: string,
  profileId: string,
  packageRoot: string,
  onWarning?: (warning: ExtensionsWarning) => void,
  contributionsRegistry?: ExtensionsContributionRegistry,
): Promise<ExtensionsManifest | undefined> {
  const filePath = path.join(profilePath, "extensions.yaml");
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    throw new ExtensionsLoadError(
      `Failed to read extensions.yaml in profile "${profileId}": ${(error as Error).message}`,
      { cause: error },
    );
  }
  const rawData = parseYaml(raw);
  const contributions = listContributions(contributionsRegistry);
  const { schema: ExtensionsYamlSchema, knownKeys } =
    composeExtensionsYamlSchema(contributions);
  // Detect unknown top-level keys *before* Zod parsing. With `.passthrough()`
  // they would land in `parsed.data` silently; the warning makes the
  // discrepancy visible to anyone who passes an `onWarning` callback (today,
  // the validator). Production callers (the runner's loadProfileDefinition)
  // omit the callback because validate already ran upstream.
  if (
    onWarning !== undefined &&
    typeof rawData === "object" &&
    rawData !== null &&
    !Array.isArray(rawData)
  ) {
    for (const key of Object.keys(rawData as Record<string, unknown>)) {
      if (!knownKeys.includes(key)) {
        onWarning({
          code: "extensions-unknown-key",
          message: `extensions.yaml in profile "${profileId}" has unknown top-level key "${key}" (not in known set: ${knownKeys.join(", ")})`,
          path: filePath,
        });
      }
    }
  }
  const parsed = ExtensionsYamlSchema.safeParse(rawData) as
    | { success: true; data: Record<string, unknown> }
    | { success: false; error: z.ZodError };
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => {
        const where = i.path.length > 0 ? i.path.join(".") : "<root>";
        return `${where}: ${i.message}`;
      })
      .join("; ");
    throw new ExtensionsLoadError(
      `Invalid extensions.yaml in profile "${profileId}": ${issues}`,
    );
  }
  const data = parsed.data as {
    extensions?: readonly z.infer<typeof ExtensionEntrySchema>[];
    upfront_context?: readonly z.infer<typeof UpfrontContextItemSchema>[];
    requires_binaries?: readonly string[];
    requires_binaries_per_scenario?: Readonly<Record<string, readonly string[]>>;
    metrics?: readonly MetricRule[];
    tool_owner?: readonly z.infer<typeof ToolOwnerEntrySchema>[];
    [key: string]: unknown;
  };
  const extensions: ResolvedExtension[] = (data.extensions ?? []).map(
    (entry) => ({
      package: entry.package,
      version: entry.version,
      entry: entry.entry,
      resolvedPath: resolveExtensionPath(entry.package, entry.entry, packageRoot),
      appliesToScenarios: entry.applies_to_scenarios,
    }),
  );
  const upfrontContext: UpfrontContextItem[] = (data.upfront_context ?? []).map(
    (item) => ({
      appliesToScenarios: item.applies_to_scenarios,
      command: item.command,
      args: item.args,
      cwd: item.cwd,
      ...(item.timeout_ms !== undefined ? { timeoutMs: item.timeout_ms } : {}),
      header: item.header,
      ...(item.notes !== undefined ? { notes: item.notes } : {}),
    }),
  );
  const requiresBinaries: readonly string[] = data.requires_binaries ?? [];
  const requiresBinariesPerScenario: Readonly<Record<string, readonly string[]>> =
    data.requires_binaries_per_scenario ?? {};
  const metricRules: readonly MetricRule[] = data.metrics ?? [];
  // Surface duplicate metric ids inside the same profile as a warning. The
  // dispatcher (Bullet 4.2) would silently overwrite the second value; a
  // duplicate is almost always a copy-paste error.
  if (onWarning !== undefined) {
    const seenMetricIds = new Set<string>();
    for (const rule of metricRules) {
      if (seenMetricIds.has(rule.id)) {
        onWarning({
          code: "metrics-duplicate-id",
          message: `extensions.yaml in profile "${profileId}" declares metric id "${rule.id}" more than once`,
          path: filePath,
        });
      }
      seenMetricIds.add(rule.id);
    }
  }
  const toolOwnerEntries = data.tool_owner ?? [];
  const toolOwners: Record<string, string> = {};
  if (onWarning !== undefined) {
    for (const entry of toolOwnerEntries) {
      const existing = toolOwners[entry.name];
      if (existing !== undefined && existing !== entry.owner) {
        onWarning({
          code: "tool-owner-conflict",
          message: `extensions.yaml in profile "${profileId}" declares conflicting owners for tool "${entry.name}": "${existing}" and "${entry.owner}"`,
          path: filePath,
        });
      }
      toolOwners[entry.name] = entry.owner;
    }
  } else {
    for (const entry of toolOwnerEntries) {
      toolOwners[entry.name] = entry.owner;
    }
  }
  // Bullet 16.2 — capture every contribution's parsed value (when
  // present). The convenience fields `pinnedAgents` / `languageServers`
  // are populated from this map via small adapter shims.
  const contributionValues: Record<string, unknown> = {};
  for (const contribution of contributions) {
    const v = data[contribution.key];
    if (v !== undefined) contributionValues[contribution.key] = v;
  }
  return {
    extensions,
    upfrontContext,
    requiresBinaries,
    requiresBinariesPerScenario,
    languageServers: languageServersFromContributions(contributionValues),
    metricRules,
    toolOwners,
    pinnedAgents: pinnedAgentsFromContributions(contributionValues),
    contributions: contributionValues,
  };
}

export function resolveExtensionPathsForScenario(
  manifest: ExtensionsManifest | undefined,
  scenarioId: string,
): string[] {
  if (manifest === undefined) return [];
  return manifest.extensions
    .filter(
      (e) =>
        e.appliesToScenarios === undefined ||
        e.appliesToScenarios.includes(scenarioId),
    )
    .map((e) => e.resolvedPath);
}
