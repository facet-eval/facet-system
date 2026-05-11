// @facet/sdk — factor-kind.ts
//
// Public contract for factor kinds — the data-side discriminator that
// drives `varying_factors[].type` in a spec. A factor kind handler knows
// (a) what a single level of its kind looks like (validated by `levelSchema`),
// (b) how to enumerate the cross-product axis values from a declared factor
//     (`expand`), and
// (c) how to apply one axis value's contribution to a run-config draft
//     (`apply`).
//
// The runner builds the matrix by collecting axes from every registered
// factor kind, taking the cartesian product, and folding each combination
// through every kind's `apply` to produce the final `RunConfig`. Adding a
// new kind is a plugin author concern: declare it, register it, no
// framework edit required.

import type { ZodType } from "zod";

// One value in the matrix axis for a given factor of this kind. The runner
// produces one combination per cartesian slice and threads each combination
// through every kind's `apply` to assemble the final run config.
// ts-prune-ignore-next
export interface FactorAxisValue<TLevel = unknown> {
  // The factor's id from the spec (e.g. "prompt_id", "tokenizer"). Used
  // to disambiguate when the same kind appears more than once in a spec.
  readonly factorId: string;
  // The level's id from the spec (e.g. "underspecified", "gpt-tokenizer").
  // Surfaces in the run id, the matrix coordinates, and aggregated rows.
  readonly levelId: string;
  // The parsed level object. Shape is whatever `levelSchema` defines.
  readonly level: TLevel;
}

// Mutable draft passed sequentially to each registered factor kind's
// `apply` during matrix expansion. The runner freezes it into a typed
// `RunConfig` once every axis has contributed. Open by design — plugin
// kinds can write new keys (e.g. `tokenizerId` from a `tokenizer_swap`
// factor) and the runner threads them through to the trace + manifest.
// ts-prune-ignore-next
export interface RunConfigDraft {
  promptId?: string;
  profileId?: string;
  profileRef?: string;
  profileHash?: string;
  modelLevelId?: string;
  provider?: string;
  modelInternalId?: string;
  harnessParams?: Record<string, unknown>;
  [key: string]: unknown;
}

// Shape of the parent factor object passed to `expand`. The `id`, `type`,
// `description`, `levels` fields are universal; kind-specific fields (e.g.
// `model_param`'s `param: string`) appear on the concrete factor type the
// handler declares.
// ts-prune-ignore-next
export interface FactorRecordBase {
  readonly id: string;
  readonly type: string;
  readonly description: string;
}

// ts-prune-ignore-next
export interface FactorKindHandler<
  TLevel = unknown,
  TFactor extends FactorRecordBase = FactorRecordBase,
> {
  // Discriminator value, e.g. "prompt_swap", "extension_select",
  // "model_swap", "model_param", or a plugin-added kind like
  // "tokenizer_swap". Must be unique within the active registry.
  readonly id: string;
  // Validates a single level of this kind. The spec parser substitutes
  // this into the factor's `levels: array(levelSchema).min(1)` when
  // composing the dynamic ExperimentSpecSchema.
  readonly levelSchema: ZodType<TLevel>;
  // Optional schema validating the parent factor object beyond the
  // universal fields. Used by kinds like `model_param` that carry extra
  // configuration (the param name) at the factor level.
  readonly factorSchema?: ZodType<TFactor>;
  // Enumerate the axis values this factor contributes. Typical
  // implementation: `factor.levels.map(level => ({ factorId, levelId,
  // level }))`. A handler may also collapse or expand levels (e.g. a
  // `repetitions` factor could emit N copies of each level).
  expand(factor: TFactor): readonly FactorAxisValue<TLevel>[];
  // Mutate the draft to reflect this axis value. Called once per kind
  // per matrix combination, in registration order. Implementations
  // should be idempotent under reapplication and avoid reading keys
  // that earlier kinds in the same combination have not yet written.
  apply(value: FactorAxisValue<TLevel>, draft: RunConfigDraft): void;
}

// ts-prune-ignore-next
export function defineFactorKind<
  TLevel,
  TFactor extends FactorRecordBase = FactorRecordBase,
>(
  handler: FactorKindHandler<TLevel, TFactor>,
): FactorKindHandler<TLevel, TFactor> {
  return handler;
}
