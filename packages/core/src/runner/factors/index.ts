// Factor registry + matrix expansion helpers.
//
// Pre-Bullet-12.4 this file owned a closed switch over the four
// hardcoded factor kinds (`prompt_swap`, `extension_select`,
// `model_swap`, `model_param`). After Bullet 12.4 the four kinds live
// as `defineFactorKind` builtins under `src/builtins/factor-kinds/`,
// and `expandMatrixWithRegistry(factors, registry)` dispatches over
// whatever the registry exposes — including kinds added by plugins.
//
// The original `collectFactorAxes` and `buildModelParamCombinations`
// stay here as the production path: the runner has not yet been
// switched to the registry version (Phase 12.7 flips the default once
// every axis builtin is wired up). The two paths produce the same
// output for the four core kinds; the registry path additionally
// supports plugin-declared kinds.

import type {
  ModelLevel,
  ModelParamLevel,
  ProfileLevel,
  PromptLevel,
  VaryingFactor,
} from "../../spec/schema.js";

import type { FactorKindRegistry } from "../../registries/factor-kind-registry.js";
import type {
  FactorAxisValue,
  RunConfigDraft,
} from "@facet/sdk/factor-kind";

export interface ModelParamAxis {
  readonly factorId: string;
  readonly param: string;
  readonly levels: readonly ModelParamLevel[];
}

export interface FactorAxes {
  readonly prompts: readonly PromptLevel[];
  readonly profiles: readonly ProfileLevel[];
  readonly models: readonly ModelLevel[];
  readonly modelParams: readonly ModelParamAxis[];
}

/**
 * Bins `spec.varying_factors` by application kind. Throws if any of the
 * three required kinds (`prompt_swap`, `extension_select`, `model_swap`)
 * has no factor — the runner needs them to produce a complete RunConfig.
 * `model_param` factors are optional and accumulate.
 */
export function collectFactorAxes(factors: readonly VaryingFactor[]): FactorAxes {
  const prompts: PromptLevel[] = [];
  const profiles: ProfileLevel[] = [];
  const models: ModelLevel[] = [];
  const modelParams: ModelParamAxis[] = [];
  for (const factor of factors) {
    switch (factor.type) {
      case "prompt_swap":
        prompts.push(...factor.levels);
        break;
      case "extension_select":
        profiles.push(...factor.levels);
        break;
      case "model_swap":
        models.push(...factor.levels);
        break;
      case "model_param":
        modelParams.push({
          factorId: factor.id,
          param: factor.param,
          levels: factor.levels,
        });
        break;
    }
  }
  return { prompts, profiles, models, modelParams };
}

/**
 * Cartesian product over `model_param` axes. Returns an array of
 * `Record<param, value>` — one record per combination of one level per
 * axis. With zero axes returns a single empty record (so the outer
 * matrix loop runs once even when no `model_param` factor is declared).
 */
export function buildModelParamCombinations(
  axes: readonly ModelParamAxis[],
): readonly Readonly<Record<string, unknown>>[] {
  if (axes.length === 0) return [{}];
  let combos: Record<string, unknown>[] = [{}];
  for (const axis of axes) {
    const next: Record<string, unknown>[] = [];
    for (const partial of combos) {
      for (const level of axis.levels) {
        next.push({ ...partial, [axis.param]: level.value });
      }
    }
    combos = next;
  }
  return combos;
}

// Bullet 12.4 — generic registry-driven matrix expansion.
//
// `expandMatrixWithRegistry(factors, registry, baseDraft?)` returns one
// `RunConfigDraft` per cross-product combination of every declared
// factor's axis values. Unlike `collectFactorAxes` it does not assume a
// fixed set of factor kinds — every kind handler the registry exposes
// participates, including plugin-declared ones.
//
// The wider `FactorAxisValue & { factor }` shape passed to `apply` is
// an implementation aid: kinds like `model_param` need the parent
// factor record to discover the param name (`factor.param`). The
// widening is invisible to consumers who only read `factorId`,
// `levelId`, `level` from the public `FactorAxisValue` surface.

interface FactorAxisValueWithFactor extends FactorAxisValue {
  readonly factor: VaryingFactor;
}

// ts-prune-ignore-next
export function expandMatrixWithRegistry(
  factors: readonly VaryingFactor[],
  registry: FactorKindRegistry,
  baseDraft: RunConfigDraft = {},
): RunConfigDraft[] {
  if (factors.length === 0) {
    return [{ ...baseDraft }];
  }

  const axesByFactor: {
    readonly factor: VaryingFactor;
    readonly axisValues: readonly FactorAxisValueWithFactor[];
  }[] = [];
  for (const factor of factors) {
    const handler = registry.get(factor.type);
    if (handler === undefined) {
      throw new Error(
        `No factor-kind handler registered for type "${factor.type}" (factor id: "${factor.id}")`,
      );
    }
    const rawValues = handler.expand(factor as never) as readonly FactorAxisValue[];
    const widened = rawValues.map((v) => ({ ...v, factor }));
    axesByFactor.push({ factor, axisValues: widened });
  }

  let combos: FactorAxisValueWithFactor[][] = [[]];
  for (const axis of axesByFactor) {
    const next: FactorAxisValueWithFactor[][] = [];
    for (const partial of combos) {
      for (const axisValue of axis.axisValues) {
        next.push([...partial, axisValue]);
      }
    }
    combos = next;
  }

  return combos.map((combo) => {
    const draft: RunConfigDraft = { ...baseDraft };
    for (const axisValue of combo) {
      const handler = registry.get(axisValue.factor.type);
      // unreachable per construction — every axis value comes from a
      // handler that was looked up above.
      if (handler === undefined) continue;
      handler.apply(axisValue, draft);
    }
    return draft;
  });
}
