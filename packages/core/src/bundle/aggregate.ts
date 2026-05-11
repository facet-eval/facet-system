import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { LAYER2_FRAMEWORK_KEYS } from "../evaluator/layer2.js";
import { RUN_DIR_RE } from "./naming.js";

export class AggregateError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AggregateError";
  }
}

// Static (always-present) column set. The framework writes these in this
// fixed order. Profile-declared metric columns (graph_queries_count,
// lens_warnings_received, etc. — Phase 4 / architecture doc §R1) are
// appended dynamically per spec, sorted by metric id, and follow the
// static set in the CSV header.
export const AGGREGATED_CSV_STATIC_COLUMNS = [
  "run_id",
  "prompt_id",
  "profile",
  "model",
  "scenario",
  "repetition",
  "tests_passed",
  "exit_code",
  "duration_ms",
  "tokens_in",
  "tokens_out",
  "tasks_passed",
  "regression_tests_passed",
  "regression_tests_total",
  "tool_calls_total",
  "files_read_unique",
  "turns_to_first_edit",
  "repeated_file_edits",
  "clarification_requests_count",
  "bash_commands_count",
  "tokens_in_upfront",
  "context_window_size",
  "context_utilization_max_pct",
  "context_utilization_avg_pct",
] as const;

type CsvRow = Record<string, string>;

const STATIC_COLUMN_SET: ReadonlySet<string> = new Set(
  AGGREGATED_CSV_STATIC_COLUMNS,
);

const ConfigSchema = z
  .object({
    run_id: z.string().min(1),
    prompt_id: z.string().min(1),
    profile: z.string().min(1),
    model: z.string().min(1),
    scenario: z.string().min(1),
    repetition: z.number().int().nonnegative(),
  })
  .passthrough();

const SummarySchema = z
  .object({
    duration_ms: z.number().nonnegative().optional(),
    tokens_in: z.number().nonnegative().optional(),
    tokens_out: z.number().nonnegative().optional(),
    status: z.string().optional(),
    // Phase 10 / Bullet 10.8 — B-04. Canonical key is `tasks_passed`;
    // older bundles may carry `tasks_completed` and are read for back-
    // compat. New runs only write `tasks_passed`.
    tasks_passed: z.number().int().nonnegative().optional(),
    tasks_completed: z.number().int().nonnegative().optional(),
    tasks_total: z.number().int().nonnegative().optional(),
    regression_tests_passed: z.number().int().nonnegative().optional(),
    regression_tests_total: z.number().int().nonnegative().optional(),
    clarification_requests_count: z.number().int().nonnegative().optional(),
    // Phase 10 / Bullet 10.8 — B-05. Per-run wall-clock observation.
    // Lets a downstream reader reconstruct parallelism without relying
    // on cross-bundle clock skew. ISO-8601 UTC.
    started_at: z.string().optional(),
    finished_at: z.string().optional(),
  })
  .passthrough();

// Open record. Static framework keys still get type-validated; profile-
// declared keys (Phase 4) come through `.passthrough()` and are
// preserved on the parsed object as the dynamic CSV columns.
const MetricsSchema = z
  .object({
    tool_calls_total: z.number().int().nonnegative().optional(),
    tool_calls_per_type: z.record(z.string(), z.number().int().nonnegative()).optional(),
    files_read_unique: z.number().int().nonnegative().optional(),
    turns_to_first_edit: z.number().int().nonnegative().nullable().optional(),
    repeated_file_edits: z.number().int().nonnegative().optional(),
    clarification_requests_count: z.number().int().nonnegative().optional(),
    bash_commands_count: z.number().int().nonnegative().optional(),
    tokens_in_upfront: z.number().nonnegative().optional(),
    tokens_in_total: z.number().nonnegative().optional(),
    tokens_out_total: z.number().nonnegative().optional(),
    context_window_size: z.number().nonnegative().optional(),
    context_utilization_max_pct: z.number().nonnegative().optional(),
    context_utilization_avg_pct: z.number().nonnegative().optional(),
  })
  .passthrough();

const TestsSchema = z
  .object({
    passed: z.boolean(),
    exitCode: z.number().int().optional(),
    exit_code: z.number().int().optional(),
    // Phase 10 / Bullet 10.8 — B-04. Same back-compat policy as SummarySchema.
    tasks_passed: z.number().int().nonnegative().optional(),
    tasks_completed: z.number().int().nonnegative().optional(),
    regression_tests_passed: z.number().int().nonnegative().optional(),
    regression_tests_total: z.number().int().nonnegative().optional(),
  })
  .passthrough();

async function readOptionalJson(filePath: string): Promise<unknown | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readRequiredYaml(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return parseYaml(raw);
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function formatCsvLine(values: readonly string[]): string {
  return values.map(escapeCsvField).join(",");
}

export async function collectAggregatedRows(bundlePath: string): Promise<CsvRow[]> {
  const runsDir = path.join(bundlePath, "runs");
  let runEntries: string[];
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    runEntries = entries
      .filter((e) => e.isDirectory() && RUN_DIR_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch (error) {
    throw new AggregateError(
      `Cannot read runs directory at ${runsDir}: ${(error as Error).message}`,
      { cause: error },
    );
  }

  const rows: CsvRow[] = [];
  for (const runId of runEntries) {
    const runDir = path.join(runsDir, runId);
    const configRaw = await readRequiredYaml(path.join(runDir, "config.yaml")).catch((error) => {
      throw new AggregateError(
        `Run ${runId}: cannot read config.yaml: ${(error as Error).message}`,
        { cause: error },
      );
    });
    const configParsed = ConfigSchema.safeParse(configRaw);
    if (!configParsed.success) {
      throw new AggregateError(
        `Run ${runId}: invalid config.yaml: ${configParsed.error.issues
          .map((i) => i.message)
          .join("; ")}`,
      );
    }
    const config = configParsed.data;

    const summaryRaw = await readOptionalJson(path.join(runDir, "summary.json"));
    const summary = summaryRaw === undefined ? undefined : SummarySchema.parse(summaryRaw);

    const testsRaw = await readOptionalJson(path.join(runDir, "tests.json"));
    const tests = testsRaw === undefined ? undefined : TestsSchema.parse(testsRaw);

    const metricsRaw = await readOptionalJson(path.join(runDir, "metrics.json"));
    const metrics = metricsRaw === undefined ? undefined : MetricsSchema.parse(metricsRaw);

    const exitCode = tests?.exitCode ?? tests?.exit_code;
    // Phase 10 / Bullet 10.8 — prefer `tasks_passed` (canonical), fall back
    // to `tasks_completed` for pre-Phase-10 bundles, in both summary and
    // tests files.
    const tasksPassedValue =
      summary?.tasks_passed ??
      tests?.tasks_passed ??
      summary?.tasks_completed ??
      tests?.tasks_completed;
    const regressionPassed =
      summary?.regression_tests_passed ?? tests?.regression_tests_passed;
    const regressionTotal =
      summary?.regression_tests_total ?? tests?.regression_tests_total;
    const clarificationCount =
      metrics?.clarification_requests_count ?? summary?.clarification_requests_count;

    const numCell = (n: number | null | undefined): string =>
      n === undefined || n === null ? "" : String(n);

    const row: CsvRow = {
      run_id: config.run_id,
      prompt_id: config.prompt_id,
      profile: config.profile,
      model: config.model,
      scenario: config.scenario,
      repetition: String(config.repetition),
      tests_passed: tests === undefined ? "" : tests.passed ? "1" : "0",
      exit_code: exitCode === undefined ? "" : String(exitCode),
      duration_ms: summary?.duration_ms !== undefined ? String(summary.duration_ms) : "",
      tokens_in: summary?.tokens_in !== undefined ? String(summary.tokens_in) : "",
      tokens_out: summary?.tokens_out !== undefined ? String(summary.tokens_out) : "",
      tasks_passed: tasksPassedValue !== undefined ? String(tasksPassedValue) : "",
      regression_tests_passed:
        regressionPassed !== undefined ? String(regressionPassed) : "",
      regression_tests_total:
        regressionTotal !== undefined ? String(regressionTotal) : "",
      tool_calls_total: numCell(metrics?.tool_calls_total),
      files_read_unique: numCell(metrics?.files_read_unique),
      turns_to_first_edit: numCell(metrics?.turns_to_first_edit ?? null),
      repeated_file_edits: numCell(metrics?.repeated_file_edits),
      clarification_requests_count: numCell(clarificationCount),
      bash_commands_count: numCell(metrics?.bash_commands_count),
      tokens_in_upfront: numCell(metrics?.tokens_in_upfront),
      context_window_size: numCell(metrics?.context_window_size),
      context_utilization_max_pct: numCell(metrics?.context_utilization_max_pct),
      context_utilization_avg_pct: numCell(metrics?.context_utilization_avg_pct),
    };

    // Profile-declared metric keys (Phase 4 / architecture doc §R1).
    // Anything in metrics.json that is NOT framework-owned (per the
    // canonical set in LAYER2_FRAMEWORK_KEYS) and is a primitive number
    // becomes a dynamic CSV column. The aggregator union-and-sort happens
    // later in `buildAggregatedCsvColumns`.
    if (metrics !== undefined) {
      for (const [key, value] of Object.entries(metrics)) {
        if (LAYER2_FRAMEWORK_KEYS.has(key)) continue;
        if (typeof value === "number") {
          row[key] = String(value);
        }
      }
    }

    rows.push(row);
  }
  return rows;
}

// Computes the deterministic column order for a freshly aggregated bundle.
// Static columns first, then the union of profile-declared metric keys
// observed across all rows, sorted ascending. Header is predictable per
// bundle (read manifest.yaml's profile set ahead of time and you know
// what columns will appear), but no longer stable across bundles whose
// profiles declare different metric sets.
export function buildAggregatedCsvColumns(rows: readonly CsvRow[]): string[] {
  const dynamic = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (STATIC_COLUMN_SET.has(key)) continue;
      dynamic.add(key);
    }
  }
  return [
    ...AGGREGATED_CSV_STATIC_COLUMNS,
    ...[...dynamic].sort(),
  ];
}

export async function writeAggregatedCSV(bundlePath: string): Promise<string> {
  const rows = await collectAggregatedRows(bundlePath);
  const columns = buildAggregatedCsvColumns(rows);
  const aggregatedDir = path.join(bundlePath, "aggregated");
  await mkdir(aggregatedDir, { recursive: true });
  const lines: string[] = [];
  lines.push(formatCsvLine(columns));
  for (const row of rows) {
    lines.push(formatCsvLine(columns.map((col) => row[col] ?? "")));
  }
  const outputPath = path.join(aggregatedDir, "results.csv");
  await writeFile(outputPath, lines.join("\n") + "\n", "utf8");
  return outputPath;
}

/**
 * Phase 10 / Bullet 10.1 — F-45. Emit `aggregated/results.jsonl` —
 * one JSON object per row, keys are the same column set as the CSV.
 * Numeric-looking cell values stay strings; downstream readers that
 * want native types can cast (the on-disk shape is uniform with the
 * CSV one).
 */
export async function writeAggregatedJSONL(bundlePath: string): Promise<string> {
  const rows = await collectAggregatedRows(bundlePath);
  const columns = buildAggregatedCsvColumns(rows);
  const aggregatedDir = path.join(bundlePath, "aggregated");
  await mkdir(aggregatedDir, { recursive: true });
  const lines: string[] = [];
  for (const row of rows) {
    const obj: Record<string, string> = {};
    for (const col of columns) obj[col] = row[col] ?? "";
    lines.push(JSON.stringify(obj));
  }
  const outputPath = path.join(aggregatedDir, "results.jsonl");
  await writeFile(outputPath, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
  return outputPath;
}
