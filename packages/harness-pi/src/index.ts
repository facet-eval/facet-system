import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import {
  defineHarness,
  type HarnessAdapter,
  type HarnessRunConfig,
  type HarnessRunResult,
} from "@facet/sdk/harness";
import type { TraceEvent } from "@facet/sdk/trace-event";
import { translateEvent } from "./translate.js";
import type {
  PiEvent,
  PiSessionConfig,
  PiSessionResult,
  PiTokenUsage,
} from "./types.js";

export { type PiEvent, type PiSessionConfig, type PiSessionResult, type PiTokenUsage };
export { translateEvent } from "./translate.js";

// Stable harness id surfaced on the trace's `_meta` line and in the
// manifest provenance block (Phase 7 will expand the latter).
export const HARNESS_ID = "pi" as const;

// Pinned harness version, read from the installed Pi package's manifest at
// load time. Pi's package.json `exports` map blocks `require(".../package.json")`,
// so we walk up from this module to find the package directory and read the
// file directly. Lets a future trace reader compare the version that produced
// a trace against the one currently installed without parsing version fields
// out of `_meta` heuristically.
function readInstalledPiVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  while (true) {
    const candidate = path.join(
      dir,
      "node_modules",
      "@mariozechner",
      "pi-coding-agent",
      "package.json",
    );
    try {
      const raw = readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
      break;
    } catch {
      // not here, walk up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "unknown";
}

export const HARNESS_VERSION: string = readInstalledPiVersion();

export class PiAdapterError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PiAdapterError";
  }
}

// Fallback for direct callers (scripts, tests). Runner-driven calls always
// pass an explicit `timeoutMs` from `spec.environment.timeout_per_run_seconds`,
// so this default never applies during a real `facet run`.
const DEFAULT_TIMEOUT_MS = 120_000;

// Frozen experimental constant. study-design.md §6 mandates this exact
// English wording — do not paraphrase, translate, or shorten. The cap is a
// methodology choice (small, documented), not a config knob; injecting
// either through PiSessionConfig would defeat the point of pinning them.
export const CLARIFICATION_FALLBACK_TEXT =
  "Proceed with what you have. No additional information is available. Use your judgment to complete the task.";
export const MAX_CLARIFICATION_FALLBACKS = 3;

export interface ClarificationDriverSession {
  prompt(text: string): Promise<void>;
  subscribe(listener: (event: PiEvent) => void): () => void;
}

interface PiSessionShutdownRunner {
  hasHandlers(eventType: "session_shutdown"): boolean;
  emit(event: { readonly type: "session_shutdown"; readonly reason: "quit" }): Promise<unknown>;
}

export interface DisposablePiSession {
  readonly extensionRunner: PiSessionShutdownRunner;
  dispose(): void;
}

export async function shutdownPiSession(session: DisposablePiSession): Promise<void> {
  try {
    if (session.extensionRunner.hasHandlers("session_shutdown")) {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    }
  } finally {
    session.dispose();
  }
}

export interface ClarificationDriverOptions {
  readonly userPrompt: string;
  readonly fallbackText: string;
  readonly maxFallbacks: number;
  readonly shouldAbort?: () => boolean;
  readonly onEvent?: (event: PiEvent) => void;
  readonly onClarificationFallback?: () => void;
}

export interface ClarificationDriverResult {
  readonly clarificationRequestsCount: number;
}

// Drives a Pi-like session through one initial prompt plus up to
// `maxFallbacks` clarification re-prompts. A turn counts as a clarification
// (no-tool-call, has-text) when between two `agent_start` events the
// session emitted at least one `message_update` with a `text_delta`
// `assistantMessageEvent` and zero `tool_execution_start` events. Visible
// for tests; production callers go through `runSession`.
export async function driveClarificationLoop(
  session: ClarificationDriverSession,
  options: ClarificationDriverOptions,
): Promise<ClarificationDriverResult> {
  let sawToolCall = false;
  let sawAssistantText = false;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "agent_start") {
      sawToolCall = false;
      sawAssistantText = false;
    } else if (event.type === "tool_execution_start") {
      sawToolCall = true;
    } else if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      sawAssistantText = true;
    }
    options.onEvent?.(event);
  });

  let clarificationCount = 0;
  try {
    await session.prompt(options.userPrompt);
    while (
      options.shouldAbort?.() !== true &&
      !sawToolCall &&
      sawAssistantText &&
      clarificationCount < options.maxFallbacks
    ) {
      clarificationCount += 1;
      options.onClarificationFallback?.();
      await session.prompt(options.fallbackText);
    }
  } finally {
    unsubscribe();
  }

  return { clarificationRequestsCount: clarificationCount };
}

export interface BuildResourceLoaderOptions {
  readonly cwd: string;
  readonly systemPrompt: string;
  readonly agentDir?: string;
  readonly additionalExtensionPaths?: readonly string[];
  readonly extensionFactories?: readonly ExtensionFactory[];
  readonly appendSystemPrompts?: readonly string[];
}

// Builds the DefaultResourceLoader with the hermeticity safeguards locked
// in: noExtensions:true (only explicit additionalExtensionPaths load — no
// ~/.pi/agent/extensions, no .pi/extensions/, no settings.json packages),
// every other discovery flag off, and no-op overrides as the second line of
// defense. Exported so tests can inspect what gets loaded without standing
// up a full agent session.
export function buildResourceLoader(
  options: BuildResourceLoaderOptions,
): DefaultResourceLoader {
  const systemPromptOverride = options.systemPrompt;
  const appendSystemPrompts =
    options.appendSystemPrompts !== undefined
      ? [...options.appendSystemPrompts]
      : [];
  return new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir ?? getAgentDir(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths:
      options.additionalExtensionPaths !== undefined
        ? [...options.additionalExtensionPaths]
        : [],
    extensionFactories:
      options.extensionFactories !== undefined
        ? [...options.extensionFactories]
        : [],
    systemPromptOverride: () => systemPromptOverride,
    appendSystemPromptOverride: () => appendSystemPrompts,
    skillsOverride: () => ({ skills: [], diagnostics: [] }),
    promptsOverride: () => ({ prompts: [], diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
  });
}

export async function runSession(
  config: PiSessionConfig,
  userPrompt: string,
  cwd: string,
  onEvent?: (event: TraceEvent) => void,
): Promise<PiSessionResult> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const authStorage = AuthStorage.create();
  if (config.apiKey !== undefined && config.apiKey.length > 0) {
    authStorage.setRuntimeApiKey(config.provider, config.apiKey);
  }
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = modelRegistry.find(config.provider, config.modelId);
  if (!model) {
    throw new PiAdapterError(
      `Model not found in pi registry: provider="${config.provider}", id="${config.modelId}". ` +
        `Check that the id matches a built-in model or a custom entry in ~/.pi/agent/models.json.`,
    );
  }

  const resourceLoader = buildResourceLoader({
    cwd,
    systemPrompt: config.systemPrompt,
    ...(config.agentDir !== undefined ? { agentDir: config.agentDir } : {}),
    ...(config.additionalExtensionPaths !== undefined
      ? { additionalExtensionPaths: config.additionalExtensionPaths }
      : {}),
    ...(config.extensionFactories !== undefined
      ? { extensionFactories: config.extensionFactories }
      : {}),
    ...(config.appendSystemPrompts !== undefined
      ? { appendSystemPrompts: config.appendSystemPrompts }
      : {}),
  });
  await resourceLoader.reload();

  const extensionsResult = resourceLoader.getExtensions();
  if (extensionsResult.errors.length > 0) {
    const errorList = extensionsResult.errors
      .map((e) => `  - ${e.path}: ${e.error}`)
      .join("\n");
    throw new PiAdapterError(
      `Failed to load Pi extension(s):\n${errorList}`,
    );
  }

  if (config.harnessParams !== undefined) {
    // Phase 6 / F-58: log one warning per declared `model_param` factor
    // so a spec author sees that Pi 0.70.0 silently drops the override.
    // The values are still recorded in `runs/<id>/config.yaml` so a
    // future facet-run replay against a harness that supports them can
    // pick them up. Documented in NOTES.md [Phase 6].
    for (const [param, value] of Object.entries(config.harnessParams)) {
      console.warn(
        `WARN [harness-param-unsupported] Pi adapter cannot apply ${param}=${JSON.stringify(value)} (no SDK knob in pi-coding-agent ${HARNESS_VERSION}); value recorded in config.yaml for traceability`,
      );
    }
  }

  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: "off",
    authStorage,
    modelRegistry,
    tools: [...config.tools],
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
  });

  const events: TraceEvent[] = [];
  const startedAt = Date.now();
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let clarificationRequestsCount = 0;
  try {
    try {
      await new Promise<void>((resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          void session.abort().finally(() => resolve());
        }, timeoutMs);
        driveClarificationLoop(session, {
          userPrompt,
          fallbackText: CLARIFICATION_FALLBACK_TEXT,
          maxFallbacks: MAX_CLARIFICATION_FALLBACKS,
          shouldAbort: () => timedOut,
          // Pi events are observed by the clarification heuristic (Pi-shaped
          // by design — that is the harness coupling we keep for now), then
          // translated to FACET TraceEvents before reaching the tracer or
          // the user-supplied callback. Translator returning null means the
          // event has no FACET equivalent yet (e.g. session_start) and is
          // dropped from the trace.
          onEvent: (piEvent) => {
            const translated = translateEvent(piEvent);
            if (translated === null) return;
            events.push(translated);
            if (onEvent !== undefined) onEvent(translated);
          },
          onClarificationFallback: () => {
            clarificationRequestsCount += 1;
          },
        }).then(
          () => resolve(),
          (err: unknown) =>
            reject(err instanceof Error ? err : new Error(String(err))),
        );
      });
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }

    const durationMs = Date.now() - startedAt;
    const stats = session.getSessionStats();
    const tokenUsage: PiTokenUsage = {
      input: stats.tokens.input,
      output: stats.tokens.output,
      cacheRead: stats.tokens.cacheRead,
      cacheWrite: stats.tokens.cacheWrite,
      total: stats.tokens.total,
    };
    const finalMessage = session.getLastAssistantText();
    const costUsd = stats.cost;

    return {
      finalMessage,
      events,
      tokenUsage,
      durationMs,
      timedOut,
      costUsd,
      clarificationRequestsCount,
      contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : 0,
    };
  } finally {
    await shutdownPiSession(session);
  }
}

// Bullet 12.2: Pi-specific keys the runner threads through `HarnessRunConfig.extras`.
// The wrapper below narrows them at the boundary so the rest of the file (and the
// internal `runSession` above) keeps working with `PiSessionConfig` unchanged.
interface PiHarnessExtras {
  readonly agentDir?: string;
  readonly additionalExtensionPaths?: readonly string[];
  readonly extensionFactories?: readonly ExtensionFactory[];
  readonly appendSystemPrompts?: readonly string[];
}

function asPiExtras(
  extras: Readonly<Record<string, unknown>> | undefined,
): PiHarnessExtras {
  if (extras === undefined) return {};
  const out: {
    agentDir?: string;
    additionalExtensionPaths?: readonly string[];
    extensionFactories?: readonly ExtensionFactory[];
    appendSystemPrompts?: readonly string[];
  } = {};
  const agentDir = extras["agentDir"];
  if (typeof agentDir === "string") out.agentDir = agentDir;
  const additionalExtensionPaths = extras["additionalExtensionPaths"];
  if (Array.isArray(additionalExtensionPaths)) {
    out.additionalExtensionPaths = additionalExtensionPaths as readonly string[];
  }
  const extensionFactories = extras["extensionFactories"];
  if (Array.isArray(extensionFactories)) {
    out.extensionFactories = extensionFactories as readonly ExtensionFactory[];
  }
  const appendSystemPrompts = extras["appendSystemPrompts"];
  if (Array.isArray(appendSystemPrompts)) {
    out.appendSystemPrompts = appendSystemPrompts as readonly string[];
  }
  return out;
}

// Default `HarnessAdapter` for FACET. Wraps the internal `runSession` so the
// runner consumes the SDK contract uniformly across harnesses; Pi-specific
// extras (`agentDir`, `additionalExtensionPaths`, `extensionFactories`,
// `appendSystemPrompts`) live under `config.extras` and the wrapper unpacks
// them into `PiSessionConfig` at the boundary. Phase 13.3 will move this
// adapter (and its metric kinds + extensions contributions) to
// `@facet/harness-pi`; until then it lives in-tree.
export const PiHarness: HarnessAdapter = defineHarness({
  id: HARNESS_ID,
  version: HARNESS_VERSION,
  async runSession(
    config: HarnessRunConfig,
    userPrompt: string,
    cwd: string,
    onEvent?: (event: TraceEvent) => void,
  ): Promise<HarnessRunResult> {
    const extras = asPiExtras(config.extras);
    const piConfig: PiSessionConfig = {
      tools: config.tools,
      systemPrompt: config.systemPrompt,
      provider: config.provider,
      modelId: config.modelId,
      ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
      ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
      ...(extras.agentDir !== undefined ? { agentDir: extras.agentDir } : {}),
      ...(extras.additionalExtensionPaths !== undefined
        ? { additionalExtensionPaths: extras.additionalExtensionPaths }
        : {}),
      ...(extras.extensionFactories !== undefined
        ? { extensionFactories: extras.extensionFactories }
        : {}),
      ...(extras.appendSystemPrompts !== undefined
        ? { appendSystemPrompts: extras.appendSystemPrompts }
        : {}),
      ...(config.harnessParams !== undefined
        ? { harnessParams: config.harnessParams }
        : {}),
    };
    return runSession(piConfig, userPrompt, cwd, onEvent);
  },
});

// Default export so dynamic-import callers (`await import("@facet/harness-pi")`)
// can pick up the adapter without naming it.
// ts-prune-ignore-next
export default PiHarness;

// Bullet 13.3: register the Pi-specific metric kinds against a caller-
// supplied registry. The CLI calls this after `await import` of the
// declared harness package; tests register manually. Adapter authors
// for other harnesses expose the same shape — `default: HarnessAdapter`
// plus an optional `register(registries)` hook — so the CLI consumes
// every harness uniformly.
import { toolCallCountMetricKind } from "./metric-kinds/tool-call-count.js";
import { toolCallMaxDepthMetricKind } from "./metric-kinds/tool-call-max-depth.js";
import { toolResultMarkerCountMetricKind } from "./metric-kinds/tool-result-marker-count.js";
import { languageServersContribution } from "./extensions-contributions/language-servers.js";
import { pinnedAgentsContribution } from "./extensions-contributions/pinned-agents.js";

// Minimal structural type for the metric-kind registry slot the
// harness needs. Using `MetricKindHandler<unknown>` directly would
// require importing the SDK type and force a cast at every callsite;
// keeping the contract narrow (`{id; register; has?}`) means any
// registry implementation that exposes those two methods works.
interface MetricKindRegistryLike {
  register(handler: { readonly id: string }): void;
  readonly has?: (id: string) => boolean;
}

// Bullet 16.2 — extensions-contribution registry slot. Optional so
// callers that pass only `{ metricKind }` keep working. The runner
// threads the contribution registry through the same payload as
// every other plugin seam (Bullet 16.1).
interface ExtensionsContributionRegistryLike {
  register(entry: { readonly id: string; readonly contribution: unknown }): void;
  readonly has?: (id: string) => boolean;
}

interface RegistrySetForPi {
  readonly metricKind: MetricKindRegistryLike;
  readonly extensionsContribution?: ExtensionsContributionRegistryLike;
}

// ts-prune-ignore-next
export function register(registries: RegistrySetForPi): void {
  // Metric kinds tied to Pi's trace event shape live here, not in core.
  // Re-registration is idempotent at the harness-pi callsite — the
  // registry itself throws on duplicate id, so callers that register
  // twice without `has()` see a clear `RegistryError`.
  const kinds: Array<{ readonly id: string }> = [
    toolCallCountMetricKind,
    toolResultMarkerCountMetricKind,
    toolCallMaxDepthMetricKind,
  ];
  for (const kind of kinds) {
    if (registries.metricKind.has?.(kind.id) === true) continue;
    registries.metricKind.register(kind);
  }

  // Bullet 16.2 — Pi-specific `extensions.yaml` sub-blocks
  // (`pinned_agents`, `language_servers`). The strings used to live in
  // `packages/core/src/runner/extensions.ts`; the registry-driven
  // loader now composes the root schema from whatever the active
  // harness contributes here.
  if (registries.extensionsContribution !== undefined) {
    const contributions: Array<{ readonly id: string; readonly contribution: unknown }> = [
      { id: pinnedAgentsContribution.key, contribution: pinnedAgentsContribution },
      {
        id: languageServersContribution.key,
        contribution: languageServersContribution,
      },
    ];
    for (const entry of contributions) {
      if (registries.extensionsContribution.has?.(entry.id) === true) continue;
      registries.extensionsContribution.register(entry);
    }
  }
}
