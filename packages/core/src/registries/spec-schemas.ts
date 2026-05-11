// Dynamic spec-schema composition driven by registries.
//
// Pre-Bullet-12.3 the four spec axes that this file rebuilds dynamically
// (`evaluator.layers[].type`, `analysis.emit[]`, `environment
// .workspace_strategy`, plus `metrics.trace.capture[]` left static for now)
// were `z.enum`/`z.discriminatedUnion` literals hardcoded in
// `src/spec/schema.ts:220-267`. With the SDK + registries in place they
// become functions of the registries the caller passes in.
//
// `composeExperimentSpecSchema(registries)` returns a
// `z.ZodSchema<ExperimentSpec>` whose accepted shape mirrors what the
// registries declare. The runner / CLI will populate the registries with
// builtins (Phase 12.7) before invoking `loadSpec`; tests register
// synthetic kinds to verify the dispatch.
//
// `loadSpec(path)` keeps the closed default schema for back-compat, so
// every existing example spec parses without registry plumbing. The
// optional `loadSpec(path, registries)` overload composes from registries.

import { z } from "zod";

import {
  ComparisonSchema,
  DesignSchema,
  EnvironmentSchema,
  MetadataSchema,
  ScenarioRefSchema,
  VaryingFactorSchema,
  type ExperimentSpec,
} from "../spec/schema.js";

import type { EvaluatorLayerRegistry } from "./evaluator-layer-registry.js";
import type { OutputEmitterRegistry } from "./output-emitter-registry.js";
import type { WorkspaceStrategyRegistry } from "./workspace-strategy-registry.js";

// Tag set used by `metrics.trace.capture` — kept closed for now. Phase 12.5
// pivots this to a registry-driven enum derived from the trace-event-registry.
const TRACE_CAPTURE_TAGS = [
  "tool_calls",
  "tokens_in",
  "tokens_out",
  "latency_ms_per_turn",
  "file_reads",
  "context_size_per_turn",
] as const;

// ts-prune-ignore-next
export interface SchemaRegistries {
  readonly evaluatorLayer: EvaluatorLayerRegistry;
  readonly outputEmitter: OutputEmitterRegistry;
  readonly workspaceStrategy: WorkspaceStrategyRegistry;
}

function asEnumValues<T extends string>(values: readonly T[]): [T, ...T[]] {
  if (values.length === 0) {
    throw new Error("Cannot build enum schema from empty list of values");
  }
  return [values[0]!, ...values.slice(1)];
}

// Build the schema for a single `metrics.evaluator.layers[]` entry from the
// active evaluator-layer registry. Each handler contributes one branch
// composed of `id, type=<handler.id>, ...handler.configSchema`.
// ts-prune-ignore-next
export function buildEvaluatorLayerSchema(
  registry: EvaluatorLayerRegistry,
): z.ZodTypeAny {
  const handlers = registry.list();
  if (handlers.length === 0) {
    throw new Error(
      "evaluator-layer registry is empty; register at least one handler before composing the spec schema",
    );
  }
  const variants = handlers.map((handler) => {
    const baseShape = z.object({
      id: z.string().min(1),
      type: z.literal(handler.id),
    });
    const config = handler.configSchema;
    if (config instanceof z.ZodObject) {
      return baseShape.extend((config as z.ZodObject<z.ZodRawShape>).shape).strict();
    }
    // Non-object configSchema: validate `id`+`type` and let the handler
    // re-validate the rest of the entry at runtime. Falls through to the
    // open record shape so the layer entry parses regardless.
    return baseShape.passthrough();
  });
  if (variants.length === 1) {
    return variants[0]!;
  }
  return z.discriminatedUnion(
    "type",
    variants as unknown as readonly [
      z.ZodDiscriminatedUnionOption<"type">,
      z.ZodDiscriminatedUnionOption<"type">,
      ...z.ZodDiscriminatedUnionOption<"type">[],
    ],
  );
}

// ts-prune-ignore-next
export function buildAnalysisEmitSchema(
  registry: OutputEmitterRegistry,
): z.ZodTypeAny {
  const ids = registry.ids();
  if (ids.length === 0) {
    throw new Error(
      "output-emitter registry is empty; register at least one emitter before composing the spec schema",
    );
  }
  return z.array(z.enum(asEnumValues(ids))).min(1);
}

// ts-prune-ignore-next
export function buildEnvironmentWorkspaceStrategySchema(
  registry: WorkspaceStrategyRegistry,
): z.ZodTypeAny {
  const ids = registry.ids();
  if (ids.length === 0) {
    throw new Error(
      "workspace-strategy registry is empty; register at least one strategy before composing the spec schema",
    );
  }
  return z.enum(asEnumValues(ids));
}

// Compose a full ExperimentSpec schema from the dynamic registries plus the
// static parts of `src/spec/schema.ts` that are not registry-driven yet
// (metadata, environment fields other than workspace_strategy, varying
// factors, scenarios, design, comparisons, the closed trace.capture set).
// The returned schema's parsed shape is structurally compatible with the
// canonical `ExperimentSpec` type — the few axes that grow new kinds
// (evaluator type, emit tags, workspace_strategy) widen the corresponding
// string fields, which still satisfy the `ExperimentSpec` type because the
// canonical shape uses string-literal enums that are subtypes of `string`.
// ts-prune-ignore-next
export function composeExperimentSpecSchema(
  registries: SchemaRegistries,
): z.ZodSchema<ExperimentSpec> {
  const evaluatorLayerSchema = buildEvaluatorLayerSchema(registries.evaluatorLayer);
  const emitSchema = buildAnalysisEmitSchema(registries.outputEmitter);
  const workspaceStrategySchema = buildEnvironmentWorkspaceStrategySchema(
    registries.workspaceStrategy,
  );

  const dynamicEnvironment = z
    .object({
      timeout_per_run_seconds: z.number().int().positive(),
      max_tokens_per_run: z.number().int().positive(),
      max_total_cost_usd: z.number().positive(),
      workspace_strategy: workspaceStrategySchema,
    })
    .strict();

  const dynamicMetrics = z
    .object({
      trace: z
        .object({
          capture: z.array(z.enum(TRACE_CAPTURE_TAGS)).min(1),
        })
        .strict(),
      evaluator: z
        .object({
          layers: z.array(evaluatorLayerSchema).min(1),
        })
        .strict(),
      judge: z.null(),
    })
    .strict();

  const dynamicAnalysis = z
    .object({
      type: z.enum(["none"]),
      emit: emitSchema,
    })
    .strict();

  return z
    .object({
      metadata: MetadataSchema,
      environment: dynamicEnvironment,
      varying_factors: z.array(VaryingFactorSchema).min(1),
      scenarios: z.array(ScenarioRefSchema).min(1),
      design: DesignSchema,
      comparisons: z.array(ComparisonSchema),
      metrics: dynamicMetrics,
      analysis: dynamicAnalysis,
    })
    .strict() as unknown as z.ZodSchema<ExperimentSpec>;
}

// Suppresses ts-prune for `EnvironmentSchema` when only used for type narrowing
// somewhere downstream. Re-export keeps the import surface obvious.
// ts-prune-ignore-next
export { EnvironmentSchema };
