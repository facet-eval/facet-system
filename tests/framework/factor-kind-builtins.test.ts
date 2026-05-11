import { describe, expect, it } from "vitest";
import { z } from "zod";

import { extensionSelectFactorKind } from "@facet/core/builtins/factor-kinds/extension-select.js";
import { modelParamFactorKind } from "@facet/core/builtins/factor-kinds/model-param.js";
import { modelSwapFactorKind } from "@facet/core/builtins/factor-kinds/model-swap.js";
import { promptSwapFactorKind } from "@facet/core/builtins/factor-kinds/prompt-swap.js";
import { createFactorKindRegistry } from "@facet/core/registries/factor-kind-registry.js";
import { expandMatrixWithRegistry } from "@facet/core/runner/factors/index.js";
import {
  defineFactorKind,
  type FactorKindHandler,
  type RunConfigDraft,
} from "@facet/sdk/factor-kind";
import type { VaryingFactor } from "@facet/core/spec/schema.js";

// Bullet 12.4: factor kinds as registered builtins, plus a generic
// `expandMatrixWithRegistry` that takes the cartesian product of
// every declared factor's axis values via dispatch (no hardcoded
// switch over kinds).

describe("Bullet 12.4 — factor-kind builtins + registry dispatch", () => {
  it("registers the four core builtins without conflict", () => {
    const registry = createFactorKindRegistry();
    registry.register(promptSwapFactorKind);
    registry.register(extensionSelectFactorKind);
    registry.register(modelSwapFactorKind);
    registry.register(modelParamFactorKind);

    expect(registry.ids().sort()).toEqual([
      "extension_select",
      "model_param",
      "model_swap",
      "prompt_swap",
    ]);
  });

  it("expands a 2x1 matrix using prompt_swap + model_swap", () => {
    const registry = createFactorKindRegistry();
    registry.register(promptSwapFactorKind);
    registry.register(modelSwapFactorKind);
    registry.register(extensionSelectFactorKind);

    const factors: VaryingFactor[] = [
      {
        id: "prompt_id",
        type: "prompt_swap",
        description: "",
        levels: [{ id: "underspecified" }, { id: "specific" }],
      },
      {
        id: "profile",
        type: "extension_select",
        description: "",
        levels: [{ id: "default", ref: "./profile", hash: "sha256:00" }],
      },
      {
        id: "model",
        type: "model_swap",
        description: "",
        levels: [
          {
            id: "gemini",
            provider: "openrouter",
            model_id: "google/gemini-2.5-flash-lite",
          },
        ],
      },
    ];

    const drafts = expandMatrixWithRegistry(factors, registry);
    expect(drafts.length).toBe(2);
    expect(drafts[0]).toMatchObject({
      promptId: "underspecified",
      profileId: "default",
      modelLevelId: "gemini",
      provider: "openrouter",
      modelInternalId: "google/gemini-2.5-flash-lite",
    });
    expect(drafts[1]).toMatchObject({ promptId: "specific" });
  });

  it("expands a model_param factor — temperature axis populates harnessParams", () => {
    const registry = createFactorKindRegistry();
    registry.register(promptSwapFactorKind);
    registry.register(modelSwapFactorKind);
    registry.register(extensionSelectFactorKind);
    registry.register(modelParamFactorKind);

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
        levels: [{ id: "default", ref: "./profile", hash: "sha256:00" }],
      },
      {
        id: "model",
        type: "model_swap",
        description: "",
        levels: [{ id: "m", provider: "openrouter", model_id: "x/y" }],
      },
      {
        id: "temperature",
        type: "model_param",
        param: "temperature",
        description: "",
        levels: [
          { id: "t-cold", value: 0 },
          { id: "t-hot", value: 1 },
        ],
      },
    ];

    const drafts = expandMatrixWithRegistry(factors, registry);
    expect(drafts.length).toBe(2);
    expect(drafts[0]?.harnessParams).toEqual({ temperature: 0 });
    expect(drafts[1]?.harnessParams).toEqual({ temperature: 1 });
  });

  it("dispatches to a plugin-declared fifth factor kind (tokenizer_swap)", () => {
    const registry = createFactorKindRegistry();
    registry.register(promptSwapFactorKind);
    registry.register(modelSwapFactorKind);
    registry.register(extensionSelectFactorKind);

    interface TokenizerLevel {
      readonly id: string;
      readonly tokenizer_id: string;
    }

    const tokenizerSwap: FactorKindHandler<TokenizerLevel> = defineFactorKind({
      id: "tokenizer_swap",
      levelSchema: z
        .object({ id: z.string().min(1), tokenizer_id: z.string().min(1) })
        .strict(),
      expand: (factor) => {
        const levels = (factor as { levels: readonly TokenizerLevel[] }).levels;
        return levels.map((level) => ({
          factorId: factor.id,
          levelId: level.id,
          level,
        }));
      },
      apply: (value, draft) => {
        (draft as RunConfigDraft & { tokenizer?: string }).tokenizer =
          value.level.tokenizer_id;
      },
    });
    registry.register(tokenizerSwap);

    const factors = [
      // The plugin-declared factor — note we widen to `unknown` to bypass
      // the closed `VaryingFactor` union; the generic expander reads
      // `factor.type` and dispatches.
      {
        id: "tokenizer",
        type: "tokenizer_swap",
        description: "",
        levels: [
          { id: "cl100k", tokenizer_id: "cl100k_base" },
          { id: "o200k", tokenizer_id: "o200k_base" },
        ],
      },
      {
        id: "model",
        type: "model_swap",
        description: "",
        levels: [{ id: "m", provider: "openrouter", model_id: "x/y" }],
      },
    ] as unknown as VaryingFactor[];

    const drafts = expandMatrixWithRegistry(factors, registry);
    expect(drafts.length).toBe(2);
    expect((drafts[0] as { tokenizer?: string }).tokenizer).toBe("cl100k_base");
    expect((drafts[1] as { tokenizer?: string }).tokenizer).toBe("o200k_base");
    // model_swap still applied for both rows.
    expect(drafts[0]?.modelLevelId).toBe("m");
    expect(drafts[1]?.modelLevelId).toBe("m");
  });

  it("throws when a factor declares an unregistered kind", () => {
    const registry = createFactorKindRegistry();
    registry.register(promptSwapFactorKind);

    const factors = [
      {
        id: "unknown",
        type: "ghost_kind",
        description: "",
        levels: [{ id: "a" }],
      },
    ] as unknown as VaryingFactor[];

    expect(() => expandMatrixWithRegistry(factors, registry)).toThrow(
      /No factor-kind handler registered/,
    );
  });
});
