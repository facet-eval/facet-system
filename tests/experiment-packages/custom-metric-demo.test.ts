import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadSpec } from "@facet/core/spec/loader.js";
import { loadPlugins } from "@facet/core/plugin-loader.js";
import { createMetricKindRegistry } from "@facet/core/registries/metric-kind-registry.js";
import { runMetricKindsOverEvents } from "@facet/core/registries/metric-evaluator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const demoRoot = path.join(repoRoot, "tests/fixtures/custom-metric-demo");

// Bullet 15.2 — tests/fixtures/custom-metric-demo/ covers the canonical
// "ship a metric kind as a plugin" example. The manual acceptance
// (`pnpm facet run <demo-root> --first-run-only`
// produces metrics.json.profile_metrics.turn_latency_p95 ≠ 0) is API-
// spend-gated. This test covers the structural invariants without a
// real run: the spec parses, `metadata.plugins` survives schema
// validation, the plugin loader imports the .mjs module via the file
// URL it constructs, `register(registries)` writes the kind into the
// metric-kind registry, and the dispatcher folds synthetic `turn_end`
// events into the expected p95 value.

describe("custom-metric-demo fixture — Phase 15.2 contract", () => {
  it("parses the demo spec including metadata.plugins", async () => {
    const spec = await loadSpec(path.join(demoRoot, "spec.yaml"));
    expect(spec.metadata.id).toBe("custom-metric-demo-001");
    expect(spec.metadata.plugins).toEqual(["./plugins/turn-latency-p95"]);
    expect(spec.metadata.harness.package).toBe("@facet/harness-pi");
  });

  it("loadPlugins registers the plugin-declared metric kind and the dispatcher uses it", async () => {
    const spec = await loadSpec(path.join(demoRoot, "spec.yaml"));
    const registry = createMetricKindRegistry();
    await loadPlugins(spec.metadata.plugins ?? [], demoRoot, {
      metricKind: registry,
    });
    expect(registry.get("turn_latency_p95")).toBeDefined();

    // 10 turn_end events with latencies 100, 200, …, 1000 ms.
    // Linear p95: ceil(10*0.95)=10, sorted[9] = 1000.
    const events = Array.from({ length: 10 }, (_, i) => ({
      type: "turn_end",
      latencyMs: (i + 1) * 100,
    }));
    const result = runMetricKindsOverEvents(
      [{ id: "turn_latency_p95", kind: "turn_latency_p95", field: "latencyMs" }],
      registry,
      events as never,
    );
    expect(result).toEqual({ turn_latency_p95: 1000 });
  });
});
