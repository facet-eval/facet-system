import { z } from "zod";

// Bullet 13.2 — explicit harness selector.
// `id` is the stable discriminator surfaced in the bundle provenance.
// `package` is the npm package name the CLI dynamically imports to
// load the HarnessAdapter (e.g. `@facet/harness-pi`).
// `version` is the declared adapter version cross-checked against the
// loaded adapter's `version` field at validate time.
export const HarnessRefSchema = z
  .object({
    id: z.string().min(1),
    package: z.string().min(1),
    version: z.string().min(1),
  })
  .strict();

// Bullet 15.3 — `pi_version` shim removed. `harness` is the only
// accepted selector. The preprocess below catches the legacy field
// explicitly and raises `metadata-pi-version-removed-in-v1` with a
// migration hint, rather than letting `.strict()` emit a generic
// "Unrecognized key" message.
const MetadataInnerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    version: z.string().min(1),
    author: z.string().min(1),
    seed: z.number().int(),
    framework_version: z.string().min(1),
    harness: HarnessRefSchema,
    // Bullet 15.2 — additional plugins to load before parsing the
    // spec's data sections. Each entry is a ref resolved with the
    // same classification rule as profile refs: scoped or bare names
    // hit npm; everything else (./foo, ../foo, /abs, ~/abs) is
    // resolved relative to the experiment package directory. The CLI
    // dynamically imports each module and calls its `register(registries)`
    // hook so plugin-shipped factor kinds, metric kinds, evaluator
    // layers etc. land in the registries before schema composition.
    plugins: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const MetadataSchema = z.preprocess((input, ctx) => {
  if (typeof input !== "object" || input === null) return input;
  const obj = input as Record<string, unknown>;
  if ("pi_version" in obj) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pi_version"],
      message:
        'metadata-pi-version-removed-in-v1: `pi_version` was removed in FACET v1. ' +
        'Migrate to `metadata.harness: { id, package, version }`. ' +
        'For Pi: id="pi", package="@facet/harness-pi", version="<your pi version>".',
    });
    return z.NEVER;
  }
  return obj;
}, MetadataInnerSchema);

export const EnvironmentSchema = z
  .object({
    timeout_per_run_seconds: z.number().int().positive(),
    max_tokens_per_run: z.number().int().positive(),
    max_total_cost_usd: z.number().positive(),
    // Bullet 16.1 — open string. The actual set of accepted values is
    // the union of the workspace-strategy registry's ids at the time of
    // the run; the runner emits `unknown-workspace-strategy` at dispatch
    // time when the value is not registered. Keeping the schema open
    // lets a plugin (`metadata.plugins[]`) contribute a new strategy
    // without a framework edit; the validator additionally preflights
    // against the active registry when it can.
    workspace_strategy: z.string().min(1),
  })
  .strict();

export const PromptLevelSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

// Schema strictness policy: stays `.strict()` at the root so typos in the
// three required fields are caught, but profile authors can attach arbitrary
// experiment-specific metadata (e.g. theme tags, environment overrides,
// expected metric buckets) without a framework edit. The catch-all is typed
// as `Record<string, unknown>` so framework code that wants to read it must
// narrow at the use site — there is no implicit casting hazard.
export const ProfileLevelSchema = z
  .object({
    id: z.string().min(1),
    ref: z.string().min(1),
    hash: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ModelLevelSchema = z
  .object({
    id: z.string().min(1),
    // Phase 9 / Bullet 9.2 — F-34. Open enum: any non-empty string. The
    // harness adapter (today Pi's `ModelRegistry`) is the actual gate on
    // what's runnable. Conventional values include `openrouter`,
    // `anthropic`, `openai`, `google`, `groq`, etc. — whatever the
    // installed Pi build knows about plus any user-supplied entries in
    // `~/.pi/agent/models.json`.
    provider: z.string().min(1),
    model_id: z.string().min(1),
  })
  .strict();

// Per-level shape for a `model_param` factor (Phase 6 / F-58). Levels
// carry the value to bind to a named harness param. Today no harness
// (Pi 0.70.0 included) exposes a public knob to apply these — the
// runner threads them through to `RunConfig.harnessParams` but the
// harness adapter currently logs a "harness-param-unsupported" warning
// per applied param. The schema is in place for the day a harness
// supports the field. Documented in NOTES.md [Phase 6].
export const ModelParamLevelSchema = z
  .object({
    id: z.string().min(1),
    value: z.union([z.number(), z.string(), z.boolean()]),
  })
  .strict();

export const FactorLevelSchema = z.union([
  PromptLevelSchema,
  ProfileLevelSchema,
  ModelLevelSchema,
  ModelParamLevelSchema,
]);

// Four closed factor-application kinds (Phase 6 / F-58). The framework
// dispatches a factor's `type` field through the registry in
// `src/runner/factors/` — adding a fifth requires a deliberate framework
// change. Pre-Phase-6 specs that omit `type` get one inferred from `id`
// for the three legacy ids; new factor types must declare `type`
// explicitly.
const PromptFactorSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("prompt_swap"),
    description: z.string(),
    levels: z.array(PromptLevelSchema).min(1),
  })
  .strict();

const ProfileFactorSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("extension_select"),
    description: z.string(),
    levels: z.array(ProfileLevelSchema).min(1),
  })
  .strict();

const ModelFactorSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("model_swap"),
    description: z.string(),
    levels: z.array(ModelLevelSchema).min(1),
  })
  .strict();

const ModelParamFactorSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("model_param"),
    // Name of the harness param to bind (e.g. "temperature", "top_p").
    param: z.string().min(1),
    description: z.string(),
    levels: z.array(ModelParamLevelSchema).min(1),
  })
  .strict();

const VaryingFactorInnerSchema = z.discriminatedUnion("type", [
  PromptFactorSchema,
  ProfileFactorSchema,
  ModelFactorSchema,
  ModelParamFactorSchema,
]);

// Pre-Phase-6 specs used `id` as the discriminator (id: "prompt_id" |
// "profile" | "model"). Bullet 6.1 introduces `type` as the canonical
// discriminator so factor `id` becomes a user-visible label. For the
// three legacy ids, this preprocessor fills in `type` so existing
// example specs (and any third-party spec authored before this Phase)
// keep parsing. New factor types must declare `type` explicitly.
const LEGACY_ID_TO_TYPE: Readonly<Record<string, string>> = {
  prompt_id: "prompt_swap",
  profile: "extension_select",
  model: "model_swap",
};

export const VaryingFactorSchema = z.preprocess((input) => {
  if (typeof input !== "object" || input === null) return input;
  const obj = input as Record<string, unknown>;
  if (typeof obj.type === "string") return obj;
  const id = typeof obj.id === "string" ? obj.id : undefined;
  if (id !== undefined && id in LEGACY_ID_TO_TYPE) {
    return { ...obj, type: LEGACY_ID_TO_TYPE[id] };
  }
  return obj;
}, VaryingFactorInnerSchema);

export const ScenarioRefSchema = z
  .object({
    id: z.string().min(1),
    ref: z.string().min(1),
    hash: z.string().min(1),
  })
  .strict();

// Canonical shape of `meta.yaml` inside a scenario directory. Single source
// of truth for both the validator (preflight check) and the runner
// (load-time parse). `.passthrough()` at the root forward-compats with
// future optional meta fields (e.g. `language`, `task_ids`, `code_dir`)
// being added by later remediation phases. Strict at the well-known
// inner shapes so typos like `flie:` inside a prompt entry still error.
export const ScenarioMetaPromptSchema = z
  .object({
    id: z.string().min(1),
    file: z.string().min(1),
  })
  .passthrough();

export const ScenarioMetaSchema = z
  .object({
    id: z.string().min(1),
    prompts: z.array(ScenarioMetaPromptSchema).min(1),
    requires_binaries: z.array(z.string().min(1)).min(1).optional(),
    // Phase 8 / Bullet 8.1 — F-36. `EXPECTED_TASKS_PER_SCENARIO = 3` is no
    // longer a framework constant. A scenario declares which task ids the
    // oracle is expected to emit; the evaluator parses against that exact
    // set. Defaults to `["task1", "task2", "task3"]` when absent so existing
    // 3-task scenarios keep working without a schema bump. The order is
    // significant for `aggregated/results.csv` column order.
    task_ids: z.array(z.string().min(1)).min(1).optional(),
    // Phase 8 / Bullet 8.3 — F-38. The scenario subdirectory that becomes
    // the per-run git repo. Defaults to `"repo"` so existing scenarios
    // keep working unchanged.
    code_dir: z.string().min(1).optional(),
    // Phase 10 / Bullet 10.2 — F-47. Scenario-specific basenames to
    // exclude from `copyWorkspaceIntoRun`. Appended to the framework
    // default denylist (`.git`, `node_modules`, `__pycache__`, `dist`).
    bundle_excludes: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

// ts-prune-ignore-next
export type ScenarioMetaPrompt = z.infer<typeof ScenarioMetaPromptSchema>;
export type ScenarioMeta = z.infer<typeof ScenarioMetaSchema>;

export const DesignSchema = z
  .object({
    type: z.enum(["full_factorial"]),
    repetitions: z.number().int().positive(),
    parallelism: z.number().int().positive(),
  })
  .strict();

export const ComparisonSchema = z
  .object({
    id: z.string().min(1),
    description: z.string(),
    across: z.string().min(1),
    holding_constant: z.array(z.string().min(1)),
  })
  .strict();

const TraceCaptureSchema = z.enum([
  "tool_calls",
  "tokens_in",
  "tokens_out",
  "latency_ms_per_turn",
  "file_reads",
  "context_size_per_turn",
]);

const EvaluatorLayerSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["oracle_script"]),
    script: z.string().min(1),
    pass_condition: z.string().min(1),
  })
  .strict();

export const MetricsSchema = z
  .object({
    trace: z
      .object({
        capture: z.array(TraceCaptureSchema).min(1),
      })
      .strict(),
    evaluator: z
      .object({
        layers: z.array(EvaluatorLayerSchema).min(1),
      })
      .strict(),
    judge: z.null(),
  })
  .strict();

// Phase 10 / Bullet 10.1 — F-45. `emit` is now an array of one or more
// output-format tags. `results_table_csv` always produces
// `aggregated/results.csv`; `results_table_jsonl` additionally produces
// `aggregated/results.jsonl` (one JSON object per row, same columns as
// the CSV). The runner only honors tags it knows about; unknown tags
// would have failed schema parsing anyway because of the closed enum.
export const AnalysisSchema = z
  .object({
    type: z.enum(["none"]),
    emit: z
      .array(z.enum(["results_table_csv", "results_table_jsonl"]))
      .min(1),
  })
  .strict();

export const ExperimentSpecSchema = z
  .object({
    metadata: MetadataSchema,
    environment: EnvironmentSchema,
    varying_factors: z.array(VaryingFactorSchema).min(1),
    scenarios: z.array(ScenarioRefSchema).min(1),
    design: DesignSchema,
    comparisons: z.array(ComparisonSchema),
    metrics: MetricsSchema,
    analysis: AnalysisSchema,
  })
  .strict();

// Inferred type surface for the spec schemas. The framework re-exports
// individual aliases as downstream tooling and tests import them; the
// `ts-prune-ignore-next` comments mark types not yet imported anywhere
// in `src/` so the CI dead-export check stays clean while keeping the
// public type surface intentional.
// ts-prune-ignore-next
export type Metadata = z.infer<typeof MetadataSchema>;
// ts-prune-ignore-next
export type Environment = z.infer<typeof EnvironmentSchema>;
export type PromptLevel = z.infer<typeof PromptLevelSchema>;
export type ProfileLevel = z.infer<typeof ProfileLevelSchema>;
export type ModelLevel = z.infer<typeof ModelLevelSchema>;
export type ModelParamLevel = z.infer<typeof ModelParamLevelSchema>;
// ts-prune-ignore-next
export type FactorLevel = z.infer<typeof FactorLevelSchema>;
export type VaryingFactor = z.infer<typeof VaryingFactorSchema>;
// ts-prune-ignore-next
export type ScenarioRef = z.infer<typeof ScenarioRefSchema>;
// ts-prune-ignore-next
export type Design = z.infer<typeof DesignSchema>;
// ts-prune-ignore-next
export type Comparison = z.infer<typeof ComparisonSchema>;
// ts-prune-ignore-next
export type Metrics = z.infer<typeof MetricsSchema>;
// ts-prune-ignore-next
export type Analysis = z.infer<typeof AnalysisSchema>;
export type ExperimentSpec = z.infer<typeof ExperimentSpecSchema>;
