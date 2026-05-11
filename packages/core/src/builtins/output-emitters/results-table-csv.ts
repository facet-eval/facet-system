import { writeAggregatedCSV } from "../../bundle/aggregate.js";
import {
  defineOutputEmitter,
  type OutputEmitterHandler,
} from "@facet/sdk/output-emitter";

// Bullet 12.7 builtin: thin SDK adapter over `writeAggregatedCSV`. The
// legacy runner path keeps calling `writeAggregatedCSV` directly; this
// builtin is the registry seam Phase 13+ flips to. The CSV layout
// (`AGGREGATED_CSV_STATIC_COLUMNS` + dynamic profile metric columns)
// stays unchanged.
// ts-prune-ignore-next
export const resultsTableCsvOutputEmitter: OutputEmitterHandler =
  defineOutputEmitter({
    id: "results_table_csv",
    async emit(input) {
      await writeAggregatedCSV(input.bundlePath);
    },
  });
