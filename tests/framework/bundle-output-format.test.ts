import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectAggregatedRows,
  writeAggregatedJSONL,
} from "@facet/core/bundle/aggregate.js";
import {
  BUNDLE_NAME_PREFIX,
  RUN_DIR_RE,
  formatBundleName,
  formatBundleTimestamp,
  formatRunId,
  parseBundleName,
} from "@facet/core/bundle/naming.js";
import { BundleWriter, type RunConfig } from "@facet/core/bundle/writer.js";
import { capCapturedStream, STREAM_CAPTURE_CAP_BYTES } from "@facet/core/evaluator/index.js";

const FIXTURE_SPEC_PATH = path.resolve(
  __dirname, "..",
  "fixtures",
  "parallel-acceptance",
  "spec.yaml",
);

const RUN_CONFIG_BASE: Omit<RunConfig, "runId" | "repetition"> = {
  promptId: "underspecified",
  profileId: "default",
  modelLevelId: "gemini-2.5-flash-lite",
  provider: "openrouter",
  modelId: "google/gemini-2.5-flash-lite",
  scenarioId: "fizzbuzz-off-by-one",
};

describe("bundle naming (Phase 10 / Bullet 10.4 — F-49)", () => {
  it("formatBundleTimestamp produces a sortable UTC timestamp", () => {
    const ts = formatBundleTimestamp(new Date("2026-05-10T03:04:05Z"));
    expect(ts).toBe("20260510T030405");
  });

  it("formatBundleName concatenates prefix, id, and timestamp", () => {
    const name = formatBundleName("hello", new Date("2026-05-10T03:04:05Z"));
    expect(name).toBe(`${BUNDLE_NAME_PREFIX}hello-20260510T030405`);
  });

  it("formatRunId zero-pads to 4 digits", () => {
    expect(formatRunId(1)).toBe("run-0001");
    expect(formatRunId(42)).toBe("run-0042");
    expect(formatRunId(9999)).toBe("run-9999");
  });

  it("RUN_DIR_RE matches well-formed run-dir names and rejects others", () => {
    expect(RUN_DIR_RE.test("run-0001")).toBe(true);
    expect(RUN_DIR_RE.test("run-12345")).toBe(true);
    expect(RUN_DIR_RE.test("run-1")).toBe(false);
    expect(RUN_DIR_RE.test("run-1abc")).toBe(false);
    expect(RUN_DIR_RE.test("RUN-0001")).toBe(false);
    expect(RUN_DIR_RE.test("aggregated")).toBe(false);
  });

  it("parseBundleName extracts specId and timestamp", () => {
    expect(parseBundleName("result-hello-world-20260510T030405")).toEqual({
      specId: "hello-world",
      timestamp: "20260510T030405",
    });
    expect(parseBundleName("result-x-20260101T000000")).toEqual({
      specId: "x",
      timestamp: "20260101T000000",
    });
  });

  it("parseBundleName returns undefined for non-matching names", () => {
    expect(parseBundleName("aggregated")).toBeUndefined();
    expect(parseBundleName("result-no-timestamp")).toBeUndefined();
    expect(parseBundleName("result-20260101T000000")).toBeUndefined();
  });
});

describe("BundleWriter atomic finalization (Phase 10 / Bullet 10.5 — F-52)", () => {
  let outDir: string;
  let writer: BundleWriter;

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), "facet-atomic-"));
    writer = new BundleWriter(path.join(outDir, "bundle"));
    const { loadSpec } = await import("@facet/core/spec/loader.js");
    const spec = await loadSpec(FIXTURE_SPEC_PATH);
    await writer.initBundle(FIXTURE_SPEC_PATH, spec);
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("writeRunArtifactAtomic renames a .tmp file into place", async () => {
    const runConfig: RunConfig = { ...RUN_CONFIG_BASE, runId: "run-0001", repetition: 1 };
    await writer.initRun(runConfig);
    await writer.writeRunArtifactAtomic(
      "run-0001",
      "summary.json",
      JSON.stringify({ status: "completed_passed" }),
    );

    // No .tmp file remains.
    const runDir = writer.runDir("run-0001");
    const { existsSync } = await import("node:fs");
    expect(existsSync(path.join(runDir, "summary.json.tmp"))).toBe(false);
    expect(existsSync(path.join(runDir, "summary.json"))).toBe(true);
    const summary = JSON.parse(
      await readFile(path.join(runDir, "summary.json"), "utf8"),
    );
    expect(summary.status).toBe("completed_passed");
  });
});

describe("BundleWriter.copyWorkspaceIntoRun denylist (Phase 10 / Bullet 10.2 — F-47)", () => {
  let outDir: string;
  let writer: BundleWriter;

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), "facet-excludes-"));
    writer = new BundleWriter(path.join(outDir, "bundle"));
    const { loadSpec } = await import("@facet/core/spec/loader.js");
    const spec = await loadSpec(FIXTURE_SPEC_PATH);
    await writer.initBundle(FIXTURE_SPEC_PATH, spec);
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("skips node_modules, __pycache__, dist, and .git by default", async () => {
    const runConfig: RunConfig = { ...RUN_CONFIG_BASE, runId: "run-0001", repetition: 1 };
    await writer.initRun(runConfig);

    const workspace = path.join(outDir, "ws");
    await mkdir(path.join(workspace, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(workspace, "node_modules", "pkg", "index.js"), "x");
    await mkdir(path.join(workspace, "__pycache__"), { recursive: true });
    await writeFile(path.join(workspace, "__pycache__", "a.pyc"), "x");
    await mkdir(path.join(workspace, "dist"), { recursive: true });
    await writeFile(path.join(workspace, "dist", "out.js"), "x");
    await mkdir(path.join(workspace, ".git"), { recursive: true });
    await writeFile(path.join(workspace, ".git", "HEAD"), "ref");
    await writeFile(path.join(workspace, "src.ts"), "console.log('keep')");

    await writer.copyWorkspaceIntoRun("run-0001", workspace);

    const { existsSync } = await import("node:fs");
    const dest = path.join(writer.runDir("run-0001"), "workspace");
    expect(existsSync(path.join(dest, "src.ts"))).toBe(true);
    expect(existsSync(path.join(dest, "node_modules"))).toBe(false);
    expect(existsSync(path.join(dest, "__pycache__"))).toBe(false);
    expect(existsSync(path.join(dest, "dist"))).toBe(false);
    expect(existsSync(path.join(dest, ".git"))).toBe(false);
  });

  it("also skips scenario-declared extraExcludes basenames", async () => {
    const runConfig: RunConfig = { ...RUN_CONFIG_BASE, runId: "run-0002", repetition: 1 };
    await writer.initRun(runConfig);

    const workspace = path.join(outDir, "ws2");
    await mkdir(path.join(workspace, "tmp_state"), { recursive: true });
    await writeFile(path.join(workspace, "tmp_state", "x.bin"), "x");
    await writeFile(path.join(workspace, "src.ts"), "keep");

    await writer.copyWorkspaceIntoRun("run-0002", workspace, ["tmp_state"]);

    const { existsSync } = await import("node:fs");
    const dest = path.join(writer.runDir("run-0002"), "workspace");
    expect(existsSync(path.join(dest, "src.ts"))).toBe(true);
    expect(existsSync(path.join(dest, "tmp_state"))).toBe(false);
  });
});

describe("capCapturedStream (Phase 10 / Bullet 10.6 — F-53)", () => {
  it("returns the input unchanged when under the cap", () => {
    expect(capCapturedStream("hi", 100)).toBe("hi");
  });

  it("truncates and appends a marker when over the cap", () => {
    const huge = "a".repeat(STREAM_CAPTURE_CAP_BYTES + 50);
    const capped = capCapturedStream(huge);
    expect(capped.length).toBeLessThan(huge.length);
    expect(capped).toContain("[truncated 50 additional bytes]");
  });

  it("uses the provided cap when explicitly passed", () => {
    const capped = capCapturedStream("0123456789", 4);
    expect(capped).toBe("0123\n[truncated 6 additional bytes]\n");
  });
});

describe("writeAggregatedJSONL (Phase 10 / Bullet 10.1 — F-45)", () => {
  it("emits one JSON object per CSV row when no runs exist", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "facet-jsonl-empty-"));
    try {
      await mkdir(path.join(tmp, "runs"), { recursive: true });
      const out = await writeAggregatedJSONL(tmp);
      const text = await readFile(out, "utf8");
      expect(text).toBe("");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("matches the CSV row order and columns", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "facet-jsonl-"));
    try {
      const runDir = path.join(tmp, "runs", "run-0001");
      await mkdir(runDir, { recursive: true });
      await writeFile(
        path.join(runDir, "config.yaml"),
        `run_id: run-0001
prompt_id: underspecified
profile: default
model: gemini-2.5-flash-lite
scenario: fizzbuzz-off-by-one
repetition: 1
`,
        "utf8",
      );

      const rows = await collectAggregatedRows(tmp);
      const out = await writeAggregatedJSONL(tmp);
      const text = (await readFile(out, "utf8")).trim();
      const lines = text.split("\n");
      expect(lines).toHaveLength(rows.length);
      const parsed = JSON.parse(lines[0]!);
      expect(parsed.run_id).toBe("run-0001");
      expect(parsed.prompt_id).toBe("underspecified");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
