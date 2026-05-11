import { z } from "zod";

import { runOracle } from "../../evaluator/oracle.js";
import {
  defineEvaluatorLayer,
  type EvaluatorLayerHandler,
} from "@facet/sdk/evaluator-layer";

interface OracleScriptConfig {
  readonly script: string;
  readonly pass_condition: string;
}

// Bullet 12.7 builtin: thin SDK adapter over `runOracle`. The legacy
// runner path keeps calling `runOracle` directly today; this builtin
// is the registry seam Phase 13+ flips to. The closed `EvaluatorLayer`
// schema in `src/spec/schema.ts` and the dynamic spec composer in
// `src/registries/spec-schemas.ts` both accept this kind without
// further changes.
// ts-prune-ignore-next
export const oracleScriptEvaluatorLayer: EvaluatorLayerHandler<OracleScriptConfig> =
  defineEvaluatorLayer({
    id: "oracle_script",
    configSchema: z
      .object({
        script: z.string().min(1),
        pass_condition: z.string().min(1),
      })
      .strict(),
    async evaluate(input, config) {
      const result = await runOracle(input.scenarioPath, input.workspacePath, {
        scriptRelPath: config.script,
        timeoutMs: input.timeoutMs,
      });
      return {
        id: "oracle_script",
        passed: result.passed,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      };
    },
  });
