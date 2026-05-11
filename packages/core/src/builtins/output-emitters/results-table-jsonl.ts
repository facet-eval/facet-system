import { writeAggregatedJSONL } from "../../bundle/aggregate.js";
import {
  defineOutputEmitter,
  type OutputEmitterHandler,
} from "@facet/sdk/output-emitter";

// Bullet 12.7 builtin: thin SDK adapter over `writeAggregatedJSONL`.
// One JSON object per row, columns identical to the CSV emitter. The
// legacy runner path keeps calling `writeAggregatedJSONL` directly;
// this builtin is the registry seam Phase 13+ flips to.
// ts-prune-ignore-next
export const resultsTableJsonlOutputEmitter: OutputEmitterHandler =
  defineOutputEmitter({
    id: "results_table_jsonl",
    async emit(input) {
      await writeAggregatedJSONL(input.bundlePath);
    },
  });
