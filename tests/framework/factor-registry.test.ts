import { describe, expect, it } from "vitest";

import {
  buildModelParamCombinations,
  collectFactorAxes,
} from "@facet/core/runner/factors/index.js";
import type { VaryingFactor } from "@facet/core/spec/schema.js";

describe("collectFactorAxes (Phase 6 / F-58)", () => {
  it("bins the three required factor kinds plus model_param", () => {
    const factors: VaryingFactor[] = [
      {
        id: "prompt_id",
        type: "prompt_swap",
        description: "",
        levels: [{ id: "a" }, { id: "b" }],
      },
      {
        id: "profile",
        type: "extension_select",
        description: "",
        levels: [{ id: "p1", ref: "p1", hash: "TBD" }],
      },
      {
        id: "model",
        type: "model_swap",
        description: "",
        levels: [
          { id: "m1", provider: "openrouter", model_id: "openai/gpt-4o-mini" },
        ],
      },
      {
        id: "temperature",
        type: "model_param",
        param: "temperature",
        description: "",
        levels: [
          { id: "t0", value: 0 },
          { id: "t1", value: 1 },
        ],
      },
    ];
    const axes = collectFactorAxes(factors);
    expect(axes.prompts.map((p) => p.id)).toEqual(["a", "b"]);
    expect(axes.profiles.map((p) => p.id)).toEqual(["p1"]);
    expect(axes.models.map((m) => m.id)).toEqual(["m1"]);
    expect(axes.modelParams).toHaveLength(1);
    expect(axes.modelParams[0]?.factorId).toBe("temperature");
    expect(axes.modelParams[0]?.param).toBe("temperature");
    expect(axes.modelParams[0]?.levels.map((l) => l.value)).toEqual([0, 1]);
  });

  it("accumulates multiple model_param factors", () => {
    const factors: VaryingFactor[] = [
      {
        id: "prompt_id",
        type: "prompt_swap",
        description: "",
        levels: [{ id: "a" }],
      },
      {
        id: "profile",
        type: "extension_select",
        description: "",
        levels: [{ id: "p1", ref: "p1", hash: "TBD" }],
      },
      {
        id: "model",
        type: "model_swap",
        description: "",
        levels: [
          { id: "m1", provider: "openrouter", model_id: "openai/gpt-4o-mini" },
        ],
      },
      {
        id: "temperature",
        type: "model_param",
        param: "temperature",
        description: "",
        levels: [{ id: "t0", value: 0 }],
      },
      {
        id: "top_p_axis",
        type: "model_param",
        param: "top_p",
        description: "",
        levels: [{ id: "tp1", value: 0.9 }],
      },
    ];
    const axes = collectFactorAxes(factors);
    expect(axes.modelParams.map((a) => a.param)).toEqual([
      "temperature",
      "top_p",
    ]);
  });

  it("returns empty arrays when a required kind is absent (caller validates)", () => {
    const axes = collectFactorAxes([]);
    expect(axes.prompts).toEqual([]);
    expect(axes.profiles).toEqual([]);
    expect(axes.models).toEqual([]);
    expect(axes.modelParams).toEqual([]);
  });
});

describe("buildModelParamCombinations (Phase 6 / F-58)", () => {
  it("returns a single empty record when no axes are declared", () => {
    expect(buildModelParamCombinations([])).toEqual([{}]);
  });

  it("returns one record per level when one axis is declared", () => {
    const combos = buildModelParamCombinations([
      {
        factorId: "temperature",
        param: "temperature",
        levels: [
          { id: "t0", value: 0.0 },
          { id: "t1", value: 0.7 },
          { id: "t2", value: 1.3 },
        ],
      },
    ]);
    expect(combos).toEqual([
      { temperature: 0.0 },
      { temperature: 0.7 },
      { temperature: 1.3 },
    ]);
  });

  it("produces the cartesian product of two axes", () => {
    const combos = buildModelParamCombinations([
      {
        factorId: "temperature",
        param: "temperature",
        levels: [
          { id: "t0", value: 0 },
          { id: "t1", value: 1 },
        ],
      },
      {
        factorId: "top_p_axis",
        param: "top_p",
        levels: [
          { id: "p0", value: 0.5 },
          { id: "p1", value: 0.9 },
        ],
      },
    ]);
    expect(combos).toHaveLength(4);
    expect(combos).toEqual([
      { temperature: 0, top_p: 0.5 },
      { temperature: 0, top_p: 0.9 },
      { temperature: 1, top_p: 0.5 },
      { temperature: 1, top_p: 0.9 },
    ]);
  });

  it("supports heterogeneous level value types", () => {
    const combos = buildModelParamCombinations([
      {
        factorId: "mode",
        param: "mode",
        levels: [
          { id: "off", value: false },
          { id: "auto", value: "auto" },
          { id: "n", value: 3 },
        ],
      },
    ]);
    expect(combos).toEqual([
      { mode: false },
      { mode: "auto" },
      { mode: 3 },
    ]);
  });
});
