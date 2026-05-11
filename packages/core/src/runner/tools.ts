// Per-profile tool allowlist + scenario-aware filtering (Phase 11 /
// Bullet 11.4 — F-14).
//
// A `tools.yaml` entry is either a bare string (the tool applies to
// every scenario in the spec) or an object that pairs the name with
// `applies_to_scenarios` (the tool only applies to those scenarios).
// Bare strings are still the common case; the scoped object exists for
// profiles that ship extension-specific tools whose backends only make
// sense for a subset of scenarios.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

export class ToolsLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ToolsLoadError";
  }
}

const ToolEntrySchema = z.union([
  z.string().min(1),
  z
    .object({
      name: z.string().min(1),
      applies_to_scenarios: z.array(z.string().min(1)).min(1).optional(),
    })
    .strict(),
]);

const ToolsYamlSchema = z
  .object({
    tools: z.array(ToolEntrySchema).min(1),
  })
  .passthrough();

export interface ToolGate {
  readonly name: string;
  /** `undefined` ⇒ unconditional (applies to every scenario). */
  readonly appliesToScenarios: readonly string[] | undefined;
}

/**
 * Parse a profile's `tools.yaml` into the structured `ToolGate[]`. The
 * file is required — every profile must declare its own allowlist.
 */
export async function loadToolEntries(
  profilePath: string,
  profileId: string,
): Promise<ToolGate[]> {
  let raw: string;
  try {
    raw = await readFile(path.join(profilePath, "tools.yaml"), "utf8");
  } catch (error) {
    throw new ToolsLoadError(
      `Failed to read tools.yaml in profile "${profileId}": ${(error as Error).message}`,
      { cause: error },
    );
  }
  const parsed = ToolsYamlSchema.safeParse(parseYaml(raw));
  if (!parsed.success) {
    throw new ToolsLoadError(
      `Invalid tools.yaml in profile "${profileId}": ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return parsed.data.tools.map((entry) =>
    typeof entry === "string"
      ? { name: entry, appliesToScenarios: undefined }
      : { name: entry.name, appliesToScenarios: entry.applies_to_scenarios },
  );
}

/**
 * Flatten a profile's structured tool allowlist for a given scenario.
 * Unconditional entries are always included; gated entries are only
 * included when `scenarioId` appears in their `appliesToScenarios`.
 * Preserves the declaration order.
 */
export function resolveToolsForScenario(
  toolEntries: readonly ToolGate[],
  scenarioId: string,
): readonly string[] {
  const out: string[] = [];
  for (const entry of toolEntries) {
    if (
      entry.appliesToScenarios === undefined ||
      entry.appliesToScenarios.includes(scenarioId)
    ) {
      out.push(entry.name);
    }
  }
  return out;
}

