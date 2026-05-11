import { describe, expect, it } from "vitest";

import {
  AgentPinError,
  filterModelsJsonForProvider,
} from "@facet/core/runner/agent-pin.js";
import { ModelLevelSchema } from "@facet/core/spec/schema.js";

describe("ModelLevelSchema (Phase 9 / Bullet 9.2 — F-34)", () => {
  it("accepts the legacy 'openrouter' provider", () => {
    const level = ModelLevelSchema.parse({
      id: "m1",
      provider: "openrouter",
      model_id: "google/gemini-2.5-flash-lite",
    });
    expect(level.provider).toBe("openrouter");
  });

  it("accepts any non-empty provider string (open enum)", () => {
    const level = ModelLevelSchema.parse({
      id: "claude-3-5-sonnet",
      provider: "anthropic",
      model_id: "claude-3-5-sonnet-20241022",
    });
    expect(level.provider).toBe("anthropic");
  });

  it("rejects the empty string", () => {
    expect(() =>
      ModelLevelSchema.parse({ id: "m", provider: "", model_id: "x" }),
    ).toThrow();
  });
});

describe("filterModelsJsonForProvider (Phase 9 / Bullet 9.4 — F-31)", () => {
  it("keeps only the run's provider branch", () => {
    const input = JSON.stringify({
      providers: {
        openrouter: { models: [{ id: "a", contextWindow: 1024 }] },
        anthropic: { models: [{ id: "b", contextWindow: 200000 }] },
      },
    });
    const filtered = filterModelsJsonForProvider(input, "openrouter");
    const parsed = JSON.parse(filtered) as {
      providers: Record<string, unknown>;
    };
    expect(Object.keys(parsed.providers)).toEqual(["openrouter"]);
  });

  it("throws AgentPinError when the run's provider has zero entries", () => {
    const input = JSON.stringify({
      providers: {
        openrouter: { models: [{ id: "a", contextWindow: 1024 }] },
      },
    });
    expect(() => filterModelsJsonForProvider(input, "anthropic")).toThrow(
      AgentPinError,
    );
  });

  it("passes through unchanged when the file does not follow the {providers:{...}} shape", () => {
    const input = JSON.stringify({ custom: "entry" });
    expect(filterModelsJsonForProvider(input, "openrouter")).toBe(input);
  });

  it("passes through unchanged when the file is not valid JSON", () => {
    const input = "not json at all";
    expect(filterModelsJsonForProvider(input, "openrouter")).toBe(input);
  });
});
