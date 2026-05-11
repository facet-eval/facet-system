// Generic per-run agent-directory builder (Phase 5 / architecture doc §R2).
//
// When a profile declares `pinned_agents:` in its extensions.yaml, the
// runner copies every `.md` file under `<profilePath>/<source_dir>/` into
// the per-run agent directory, substituting `${RUN_MODEL}` (or the
// `model_placeholder` declared in the YAML) with the run's
// `<provider>/<modelId>`. The directory is plumbed into runSession via
// `PiSessionConfig.agentDir` (per-session) instead of
// `process.env.PI_CODING_AGENT_DIR` (process-global, unsafe under
// parallelism).
//
// Substitution variable set is closed: `${RUN_MODEL}` (or whatever the
// profile names via `model_placeholder`). Adding a second variable
// requires a deliberate framework change.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ExtensionsManifest } from "./extensions.js";

/**
 * Phase 9 / Bullet 9.4 — F-31. Drop every `providers.<id>` entry whose
 * id is not the run's provider. Throws `AgentPinError` when the run's
 * provider has zero models declared in the user's models.json (the
 * spec asked for a provider the user has no custom entries for —
 * either typo or the user hasn't registered the provider yet).
 *
 * Files that do not follow the `{providers: {<id>: …}}` shape are
 * passed through unchanged (best-effort forward compat).
 */
export function filterModelsJsonForProvider(
  raw: string,
  provider: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("providers" in parsed) ||
    typeof (parsed as { providers: unknown }).providers !== "object" ||
    (parsed as { providers: unknown }).providers === null
  ) {
    return raw;
  }
  const providers = (parsed as { providers: Record<string, unknown> }).providers;
  if (!(provider in providers)) {
    throw new AgentPinError(
      `models.json contains no entries for provider "${provider}"; available providers: [${Object.keys(providers).sort().join(", ")}]`,
    );
  }
  const filtered = {
    ...(parsed as object),
    providers: { [provider]: providers[provider] },
  };
  return JSON.stringify(filtered, null, 2);
}

export class AgentPinError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentPinError";
  }
}

export interface AgentPinConfig {
  readonly agentDir: string;
  readonly cleanup: () => Promise<void>;
}

export interface PrepareAgentPinParams {
  readonly extensions: ExtensionsManifest | undefined;
  readonly profilePath: string;
  readonly provider: string;
  readonly modelId: string;
  readonly runDir: string;
  // Source path for the user's custom models.json. Defaults to
  // <homedir>/.pi/agent/models.json. Tests pass a tmp path.
  readonly userModelsJsonPath?: string;
}

export async function prepareAgentPin(
  params: PrepareAgentPinParams,
): Promise<AgentPinConfig | undefined> {
  const config = params.extensions?.pinnedAgents;
  if (config === undefined) return undefined;

  const sourceDirAbs = path.resolve(params.profilePath, config.sourceDir);
  let entries;
  try {
    entries = await readdir(sourceDirAbs, { withFileTypes: true });
  } catch (error) {
    throw new AgentPinError(
      `pinned_agents.source_dir does not exist: ${sourceDirAbs}`,
      { cause: error },
    );
  }
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
  if (mdFiles.length === 0) {
    throw new AgentPinError(
      `pinned_agents.source_dir contains no *.md files: ${sourceDirAbs}`,
    );
  }

  const agentDir = path.join(params.runDir, ".pi-agent-pin");
  const agentsDir = path.join(agentDir, "agents");
  await mkdir(agentsDir, { recursive: true });

  const pinModel = `${params.provider}/${params.modelId}`;
  const placeholder = config.modelPlaceholder;
  for (const filename of mdFiles) {
    const raw = await readFile(path.join(sourceDirAbs, filename), "utf8");
    // Literal string replacement; the placeholder is whatever the YAML
    // declares (default `${RUN_MODEL}`). No regex specials are escaped
    // because the default placeholder is `${...}` which is treated
    // literally by `String.prototype.replaceAll` — no need for
    // String.raw juggling.
    const rendered = raw.split(placeholder).join(pinModel);
    await writeFile(path.join(agentsDir, filename), rendered, "utf8");
  }

  if (config.inheritUserModelsJson) {
    const userModelsJsonPath =
      params.userModelsJsonPath ?? path.join(os.homedir(), ".pi", "agent", "models.json");
    if (existsSync(userModelsJsonPath)) {
      // Phase 9 / Bullet 9.4 — F-31. Filter the inherited models.json to
      // entries matching the run's provider before staging it under the
      // per-run agentDir. The on-disk shape today is
      // `{providers: {<id>: {models: [...]}}}`; keep only the run's
      // provider branch. Other shapes pass through unchanged (best-effort)
      // so an older / future models.json layout does not break the run.
      const raw = await readFile(userModelsJsonPath, "utf8");
      const filtered = filterModelsJsonForProvider(raw, params.provider);
      await writeFile(path.join(agentDir, "models.json"), filtered, "utf8");
    }
  }

  return {
    agentDir,
    cleanup: async () => {
      await rm(agentDir, { recursive: true, force: true });
    },
  };
}
