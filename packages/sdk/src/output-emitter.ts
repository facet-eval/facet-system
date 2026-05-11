// @facet/sdk — output-emitter.ts
//
// Public contract for output emitters — the data-side discriminator that
// drives `analysis.emit[]` in a spec. Built-in emitters: `results_table_csv`
// writes `aggregated/results.csv`, `results_table_jsonl` writes
// `aggregated/results.jsonl`. Plugin emitters could write to SQLite,
// Parquet, or any other downstream-consumer-friendly format.

// One row of the aggregated results table, materialized after all runs
// finish. The column set is dynamic per spec (factor coordinates +
// metric ids registered by the active profiles) and the emitter receives
// columns + rows together so it can write a header consistently.
// ts-prune-ignore-next
export interface AggregatedResults {
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

// Input handed to every emitter at bundle-finalization time.
// ts-prune-ignore-next
export interface OutputEmitterInput {
  readonly bundlePath: string;
  readonly aggregated: AggregatedResults;
  // Stable spec id from `metadata.id`. Useful for embedding in file
  // headers or naming.
  readonly specId: string;
}

// ts-prune-ignore-next
export interface OutputEmitterHandler {
  // Discriminator value, e.g. "results_table_csv". Surfaces in
  // `analysis.emit[]` and must be unique within the active registry.
  readonly id: string;
  // Write the emitter's artifact(s) under `bundlePath`. The framework
  // guarantees `bundlePath/aggregated/` exists; emitters that write
  // elsewhere in the bundle must create their own subdirectories.
  emit(input: OutputEmitterInput): Promise<void>;
}

// ts-prune-ignore-next
export function defineOutputEmitter(
  handler: OutputEmitterHandler,
): OutputEmitterHandler {
  return handler;
}
