// @facet/sdk — evaluator-layer.ts
//
// Public contract for evaluator layer kinds — the data-side discriminator
// that drives `metrics.evaluator.layers[].type` in a spec. The framework
// builtin is `oracle_script` (runs a shell oracle and parses task
// outcomes); a plugin could add `llm_judge`, `static_analyzer`, or any
// other per-run verdict producer.

import type { ZodType } from "zod";

// Shape returned by an evaluator layer for a single run. The runner
// merges results from all declared layers into `tests.json.layers[]`
// and surfaces the per-task summary in `summary.json` and the aggregated
// CSV.
// ts-prune-ignore-next
export interface EvaluatorLayerResult {
  // Layer id from the spec (`spec.metrics.evaluator.layers[].id`).
  readonly id: string;
  // Boolean verdict for the run. Concrete semantics are layer-defined
  // (e.g. oracle_script: `exit_code == 0`).
  readonly passed: boolean;
  // Optional per-task breakdown. Keys are task ids (declared via
  // `meta.yaml.task_ids` or the default `task1/task2/task3` set);
  // values are pass/fail booleans. Omitting this disables the
  // `tasks_passed` aggregate for this layer.
  readonly tasksPassed?: Readonly<Record<string, boolean>>;
  // Optional captured stdout for the bundle (capped by the bundle
  // writer's STREAM_CAPTURE_CAP_BYTES).
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly durationMs?: number;
}

// Per-run input the evaluator layer reads from. The framework prepares
// this for every registered layer before invoking `evaluate`.
// ts-prune-ignore-next
export interface EvaluatorLayerInput {
  readonly runDir: string;
  readonly scenarioPath: string;
  readonly workspacePath: string;
  readonly expectedTaskIds: readonly string[];
  readonly timeoutMs: number;
}

// ts-prune-ignore-next
export interface EvaluatorLayerHandler<TConfig = unknown> {
  // Discriminator value, e.g. "oracle_script". Must be unique within the
  // active registry.
  readonly id: string;
  // Validates the layer-specific configuration (the `script` and
  // `pass_condition` fields for oracle_script, or whatever a plugin
  // layer needs). The runner parses the full layer entry against
  // `z.object({ id, type }).extend(configSchema.shape)` when composing
  // the dynamic ExperimentSpecSchema.
  readonly configSchema: ZodType<TConfig>;
  evaluate(
    input: EvaluatorLayerInput,
    config: TConfig,
  ): Promise<EvaluatorLayerResult>;
}

// ts-prune-ignore-next
export function defineEvaluatorLayer<TConfig>(
  handler: EvaluatorLayerHandler<TConfig>,
): EvaluatorLayerHandler<TConfig> {
  return handler;
}
