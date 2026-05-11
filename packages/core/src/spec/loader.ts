import { readFile } from "node:fs/promises";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { ZodError, type ZodSchema } from "zod";
import {
  composeExperimentSpecSchema,
  type SchemaRegistries,
} from "../registries/spec-schemas.js";
import {
  ExperimentSpecSchema,
  type ExperimentSpec,
} from "./schema.js";

export class SpecLoadError extends Error {
  public override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SpecLoadError";
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const pathStr = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `  - ${pathStr}: ${issue.message}`;
    })
    .join("\n");
}

// Bullet 12.3: `loadSpec(path)` keeps the closed default schema for
// back-compat — every existing example spec parses without registry
// plumbing. The optional second argument lets callers (today: tests;
// Phase 12.7+: the CLI after registering builtins) compose the schema
// from a registry set so plugins can register new evaluator-layer /
// output-emitter / workspace-strategy kinds without touching `src/`.
export async function loadSpec(
  path: string,
  registries?: SchemaRegistries,
): Promise<ExperimentSpec> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    throw new SpecLoadError(
      `Cannot read spec file at ${path}: ${(e as Error).message}`,
      e,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    if (e instanceof YAMLParseError) {
      throw new SpecLoadError(
        `Malformed YAML in ${path}: ${e.message}`,
        e,
      );
    }
    throw new SpecLoadError(
      `Failed to parse YAML in ${path}: ${(e as Error).message}`,
      e,
    );
  }

  // The two schemas have structurally compatible parsed shapes (both produce
  // an `ExperimentSpec`) but different zod-inferred input types — the closed
  // schema bakes literal enums while the registry-built one widens them to
  // string. Cast to the common output type for the dispatch.
  const schema = (
    registries === undefined
      ? (ExperimentSpecSchema as unknown as ZodSchema<ExperimentSpec>)
      : composeExperimentSpecSchema(registries)
  );
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new SpecLoadError(
      `Invalid spec at ${path}:\n${formatZodError(result.error)}`,
      result.error,
    );
  }
  return result.data;
}
