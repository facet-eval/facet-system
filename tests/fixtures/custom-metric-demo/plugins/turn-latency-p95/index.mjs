// Bullet 15.2 — third-party plugin example.
//
// This file is the entire contract a plugin author has to honour:
//   1. import `defineMetricKind` (or any other `defineX`) from
//      `@facet/sdk`,
//   2. declare the handler with a zod-validated config schema,
//      a `consumes` list, and the (initialState, evaluate, finalize)
//      triple,
//   3. export `register(registries)` that pushes the handler into
//      the matching registry slot.
//
// Plain ESM JavaScript (not TypeScript) so Node can dynamic-import
// the file directly without a transpiler. A real plugin author can
// ship a TS source and compile to JS in `dist/`; the FACET runtime
// only sees the .mjs/.js/.cjs file the spec references.

import { z } from "zod";

import { defineMetricKind } from "@facet/sdk/metric-kind";

export const turnLatencyP95 = defineMetricKind({
  id: "turn_latency_p95",
  configSchema: z
    .object({
      // The trace-event field on `turn_end` to read. Today Pi reports
      // `latencyMs` on `turn_end`; another harness might emit
      // `wallClockMs` or `serverLatencyMs`. The plugin author picks
      // which field the metric watches.
      field: z.string().min(1),
    })
    .strict(),
  consumes: ["turn_end"],
  initialState: () => [],
  evaluate: (event, state, config) => {
    const value = event[config.field];
    if (typeof value === "number" && Number.isFinite(value)) state.push(value);
    return state;
  },
  finalize: (state) => {
    if (state.length === 0) return 0;
    const sorted = state.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[idx];
  },
});

export function register(registries) {
  registries.metricKind.register(turnLatencyP95);
}
