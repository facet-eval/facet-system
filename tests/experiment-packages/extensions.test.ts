import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadProfileDefinition } from "@facet/core/runner/index.js";
import {
  ExtensionsLoadError,
  loadExtensionsManifest,
  resolveExtensionPath,
  resolveExtensionPathsForScenario,
  type ExtensionsManifest,
} from "@facet/core/runner/extensions.js";
import {
  buildResourceLoader,
  runSession,
} from "@facet/harness-pi";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const fixturesDir = path.join(here, "..", "fixtures");
const testExtensionPath = path.join(fixturesDir, "test-extension.ts");
const sentinelExtensionPath = path.join(fixturesDir, "sentinel-extension.ts");
const fixturePackage = path.join(repoRoot, "tests/fixtures/parallel-acceptance");

describe("resolveExtensionPath", () => {
  it("falls back to <packageRoot>/node_modules/<pkg>/<entry> when the package is not installed", () => {
    // "foo" is not a real installed package, so Node resolution throws and
    // the legacy path-join takes over. Test fixtures rely on this fallback.
    expect(resolveExtensionPath("foo", "index.ts", "/repo")).toBe(
      "/repo/node_modules/foo/index.ts",
    );
  });

  it("handles scoped packages and nested entries via the fallback", () => {
    expect(resolveExtensionPath("@scope/pkg", "extensions/lsp", "/repo")).toBe(
      "/repo/node_modules/@scope/pkg/extensions/lsp",
    );
  });

  it("resolves real installed packages from the runner's node_modules tree, ignoring packageRoot", () => {
    // Regression for the bug surfaced by the calibration pilot: previously
    // resolveExtensionPath joined packageRoot with "node_modules", which
    // failed when the experiment package lived outside the repo's
    // node_modules tree (e.g. an experiment package with no
    // node_modules of its own under pnpm). With Node-based resolution, a
    // bogus packageRoot is ignored as long as the package is actually
    // installed.
    const bogusRoot = "/totally/nonexistent/experiment/package";
    const resolved = resolveExtensionPath(
      "@mariozechner/pi-coding-agent",
      "package.json",
      bogusRoot,
    );
    expect(existsSync(resolved)).toBe(true);
    expect(resolved.startsWith(bogusRoot)).toBe(false);
  });
});

describe("resolveExtensionPathsForScenario", () => {
  it("returns [] when manifest is undefined", () => {
    expect(resolveExtensionPathsForScenario(undefined, "compound-c")).toEqual([]);
  });

  it("returns the resolved path when no applies_to filter is set", () => {
    const manifest: ExtensionsManifest = {
      extensions: [
        {
          package: "p",
          version: "1.0",
          entry: "index.ts",
          resolvedPath: "/abs/p/index.ts",
        },
      ],
      upfrontContext: [],
      constraints: {},
      requiresBinaries: [],
      requiresBinariesPerScenario: {},
      languageServers: {},
    };
    expect(resolveExtensionPathsForScenario(manifest, "any")).toEqual([
      "/abs/p/index.ts",
    ]);
  });

  it("includes the entry only when scenarioId is in applies_to_scenarios", () => {
    const manifest: ExtensionsManifest = {
      extensions: [
        {
          package: "p",
          version: "1.0",
          entry: "index.ts",
          resolvedPath: "/abs/p/index.ts",
          appliesToScenarios: ["compound-c", "compound-python"],
        },
      ],
      upfrontContext: [],
      constraints: {},
      requiresBinaries: [],
      requiresBinariesPerScenario: {},
      languageServers: {},
    };
    expect(resolveExtensionPathsForScenario(manifest, "compound-c")).toEqual([
      "/abs/p/index.ts",
    ]);
    expect(resolveExtensionPathsForScenario(manifest, "compound-haskell")).toEqual([]);
  });
});

describe("loadProfileDefinition — extensions integration", () => {
  it("returns extensions: undefined for a profile without extensions.yaml", async () => {
    const def = await loadProfileDefinition(
      fixturePackage,
      "@facet/preset-pi-default",
      "default",
    );
    expect(def.extensions).toBeUndefined();
  });

  it("loads extensions for a profile with extensions.yaml (no applies_to filter)", async () => {
    const def = await loadProfileDefinition(
      fixturePackage,
      "@facet/preset-pi-rag",
      "rag",
    );
    expect(def.extensions).toBeDefined();
    expect(def.extensions?.extensions).toHaveLength(1);
    const entry = def.extensions!.extensions[0]!;
    expect(entry.package).toBe("pi-local-rag");
    expect(entry.version).toBe("0.3.0");
    expect(entry.entry).toBe("index.ts");
    expect(entry.appliesToScenarios).toBeUndefined();
    // resolvedPath now uses Node's standard module resolution, so it points
    // at the actually installed package (under the repo's node_modules tree)
    // regardless of where the experiment package lives on disk.
    expect(entry.resolvedPath.endsWith(path.join("pi-local-rag", "index.ts"))).toBe(true);
    expect(existsSync(entry.resolvedPath)).toBe(true);
    // It is *not* a path under the experiment package's node_modules — that
    // directory does not exist, and assuming it did was the original bug.
    expect(
      entry.resolvedPath.startsWith(path.join(fixturePackage, "node_modules")),
    ).toBe(false);
  });

  it("preserves applies_to_scenarios when present", async () => {
    const def = await loadProfileDefinition(
      fixturePackage,
      "@facet/preset-pi-graph",
      "graph",
    );
    expect(def.extensions).toBeDefined();
    const entry = def.extensions!.extensions[0]!;
    expect(entry.appliesToScenarios).toEqual(["compound-c", "compound-python"]);
  });
});

describe("loadExtensionsManifest — schema validation", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "facet-ext-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when extensions.yaml is missing", async () => {
    const result = await loadExtensionsManifest(tmpDir, "test", repoRoot);
    expect(result).toBeUndefined();
  });

  it("rejects extensions.yaml with no entries", async () => {
    await writeFile(path.join(tmpDir, "extensions.yaml"), "extensions: []\n");
    await expect(loadExtensionsManifest(tmpDir, "test", repoRoot)).rejects.toThrow(
      ExtensionsLoadError,
    );
  });

  it("accepts unknown top-level keys with `.passthrough()`, surfacing them via the onWarning callback", async () => {
    // Bullet 2.2: top-level passthrough lets profile authors declare new
    // YAML keys (R1's `metrics:`, R2's `pinned_agents:`, etc.) without a
    // framework edit. The unknown-key signal moves from a hard load
    // failure to an `extensions-unknown-key` warning the validator can
    // promote via FACET_STRICT_SCHEMA.
    await writeFile(
      path.join(tmpDir, "extensions.yaml"),
      "extensions:\n  - package: x\n    version: '1'\n    entry: index.ts\nunknown_key: foo\n",
    );
    const warnings: { code: string; message: string }[] = [];
    const manifest = await loadExtensionsManifest(
      tmpDir,
      "test",
      repoRoot,
      (w) => warnings.push({ code: w.code, message: w.message }),
    );
    expect(manifest).toBeDefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("extensions-unknown-key");
    expect(warnings[0]!.message).toContain("unknown_key");
  });

  it("parses a `metrics:` block with all three kinds (Bullet 4.1)", async () => {
    await writeFile(
      path.join(tmpDir, "extensions.yaml"),
      `metrics:
  - id: my_tool_count
    kind: tool_call_count
    tool_names: ["my_tool"]
  - id: my_warnings
    kind: tool_result_marker_count
    applies_to_tools: ["write"]
    markers: ["!"]
  - id: my_max_depth
    kind: tool_call_max_depth
    tool_names: ["my_agent"]
`,
    );
    const manifest = await loadExtensionsManifest(tmpDir, "test", repoRoot);
    expect(manifest).toBeDefined();
    expect(manifest!.metricRules).toHaveLength(3);
    expect(manifest!.metricRules.map((r) => r.kind).sort()).toEqual(
      ["tool_call_count", "tool_call_max_depth", "tool_result_marker_count"].sort(),
    );
  });

  it("accepts a metric rule with any string kind (Bullet 13.3)", async () => {
    // Pre-13.3 the MetricRuleSchema was a closed discriminatedUnion over
    // the Pi-specific kinds, so an unknown kind failed at load time.
    // After 13.3 the schema is `{ id, kind: string }.passthrough()`;
    // unknown kinds load successfully and fail at dispatch time
    // (`runMetricKindsOverEvents`) with a clear
    // "No metric-kind handler registered" error. Keeps the spec
    // author's workflow uniform regardless of which harness is active.
    await writeFile(
      path.join(tmpDir, "extensions.yaml"),
      `metrics:
  - id: x
    kind: regex_match
    pattern: "foo"
`,
    );
    const manifest = await loadExtensionsManifest(tmpDir, "test", repoRoot);
    expect(manifest!.metricRules).toEqual([
      { id: "x", kind: "regex_match", pattern: "foo" },
    ]);
  });

  it("warns on duplicate metric ids inside a single profile", async () => {
    await writeFile(
      path.join(tmpDir, "extensions.yaml"),
      `metrics:
  - id: dup
    kind: tool_call_count
    tool_names: ["a"]
  - id: dup
    kind: tool_call_count
    tool_names: ["b"]
`,
    );
    const warnings: { code: string; message: string }[] = [];
    const manifest = await loadExtensionsManifest(
      tmpDir,
      "test",
      repoRoot,
      (w) => warnings.push({ code: w.code, message: w.message }),
    );
    expect(manifest).toBeDefined();
    expect(warnings.find((w) => w.code === "metrics-duplicate-id")).toBeDefined();
  });

  it("parses a `tool_owner:` block and surfaces it on the manifest", async () => {
    await writeFile(
      path.join(tmpDir, "extensions.yaml"),
      `tool_owner:
  - { name: tool_a, owner: graph }
  - { name: tool_b, owner: graph }
`,
    );
    const manifest = await loadExtensionsManifest(tmpDir, "test", repoRoot);
    expect(manifest).toBeDefined();
    expect(manifest!.toolOwners).toEqual({ tool_a: "graph", tool_b: "graph" });
  });

  it("warns on conflicting tool_owner declarations", async () => {
    await writeFile(
      path.join(tmpDir, "extensions.yaml"),
      `tool_owner:
  - { name: tool_a, owner: graph }
  - { name: tool_a, owner: rag }
`,
    );
    const warnings: { code: string; message: string }[] = [];
    await loadExtensionsManifest(
      tmpDir,
      "test",
      repoRoot,
      (w) => warnings.push({ code: w.code, message: w.message }),
    );
    expect(warnings.find((w) => w.code === "tool-owner-conflict")).toBeDefined();
  });

  it("still rejects typos *inside* a known field (inner shapes are strict)", async () => {
    // ExtensionEntrySchema is `.strict()` post-Bullet 2.2, so a typo like
    // `versoin:` inside an extension entry still fails the load even
    // though the root passes through unknown keys.
    await writeFile(
      path.join(tmpDir, "extensions.yaml"),
      "extensions:\n  - package: x\n    versoin: '1'\n    entry: index.ts\n",
    );
    await expect(loadExtensionsManifest(tmpDir, "test", repoRoot)).rejects.toThrow(
      /Invalid extensions.yaml/,
    );
  });

  it("rejects an entry missing a required field", async () => {
    await writeFile(
      path.join(tmpDir, "extensions.yaml"),
      "extensions:\n  - package: x\n    version: '1'\n",
    );
    await expect(loadExtensionsManifest(tmpDir, "test", repoRoot)).rejects.toThrow(
      ExtensionsLoadError,
    );
  });
});

describe("loadProfileDefinition → resolveExtensionPathsForScenario → buildResourceLoader (end-to-end)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "facet-e2e-"));
    // Stand up a tiny experiment package whose profile resolves to the test
    // fixture extension via the standard <packageRoot>/node_modules/<pkg>/<entry>
    // contract.
    await mkdir(path.join(tmpDir, "node_modules", "test-extension-pkg"), { recursive: true });
    await copyFile(
      testExtensionPath,
      path.join(tmpDir, "node_modules", "test-extension-pkg", "index.ts"),
    );
    await mkdir(path.join(tmpDir, "profiles", "with-ext"), { recursive: true });
    await writeFile(
      path.join(tmpDir, "profiles", "with-ext", "tools.yaml"),
      "tools: [\"read\"]\n",
    );
    await writeFile(path.join(tmpDir, "profiles", "with-ext", "SYSTEM.md"), "test\n");
    await writeFile(
      path.join(tmpDir, "profiles", "with-ext", "extensions.yaml"),
      "extensions:\n  - package: test-extension-pkg\n    version: \"0.0.1\"\n    entry: index.ts\n",
    );
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("registers the extension's tool in a loader built from the resolved path", async () => {
    const def = await loadProfileDefinition(tmpDir, "profiles/with-ext", "with-ext");
    const paths = resolveExtensionPathsForScenario(def.extensions, "any-scenario");
    expect(paths).toEqual([
      path.resolve(tmpDir, "node_modules", "test-extension-pkg", "index.ts"),
    ]);

    const loader = buildResourceLoader({
      cwd: tmpDir,
      systemPrompt: def.systemPrompt,
      additionalExtensionPaths: paths,
    });
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    const toolNames = loader
      .getExtensions()
      .extensions.flatMap((e) => Array.from(e.tools.keys()));
    expect(toolNames).toContain("noop_tool");
  });
});

describe("buildResourceLoader hermeticity", () => {
  let tmpDir: string;
  let agentDir: string;
  let cwd: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "facet-herm-"));
    agentDir = path.join(tmpDir, "agent");
    cwd = path.join(tmpDir, "cwd");
    await mkdir(path.join(agentDir, "extensions"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await copyFile(
      sentinelExtensionPath,
      path.join(agentDir, "extensions", "sentinel-extension.ts"),
    );
    // Sanity: the staged sentinel really lives where Pi would auto-discover it.
    expect(existsSync(path.join(agentDir, "extensions", "sentinel-extension.ts"))).toBe(
      true,
    );
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function toolNamesOf(loader: ReturnType<typeof buildResourceLoader>): string[] {
    return loader
      .getExtensions()
      .extensions.flatMap((e) => Array.from(e.tools.keys()));
  }

  it("additionalExtensionPaths: [] — sentinel auto-discovery is suppressed", async () => {
    const loader = buildResourceLoader({
      cwd,
      systemPrompt: "test",
      agentDir,
      additionalExtensionPaths: [],
    });
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    expect(toolNamesOf(loader)).not.toContain("__discovered_sentinel__");
  });

  it("with explicit path — loads noop_tool and still suppresses sentinel", async () => {
    const loader = buildResourceLoader({
      cwd,
      systemPrompt: "test",
      agentDir,
      additionalExtensionPaths: [testExtensionPath],
    });
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    const names = toolNamesOf(loader);
    expect(names).toContain("noop_tool");
    expect(names).not.toContain("__discovered_sentinel__");
  });
});

describe("buildResourceLoader — bad path is reported as a load error", () => {
  it("non-existent additionalExtensionPath surfaces in extensionsResult.errors", async () => {
    const loader = buildResourceLoader({
      cwd: process.cwd(),
      systemPrompt: "test",
      additionalExtensionPaths: ["/definitely/does/not/exist.ts"],
    });
    await loader.reload();
    const messages = loader
      .getExtensions()
      .errors.map((e) => `${e.path}: ${e.error}`);
    expect(
      messages.some((m) => m.includes("/definitely/does/not/exist.ts")),
    ).toBe(true);
  });
});

describe("runSession — bad extension path raises PiAdapterError", () => {
  it("throws PiAdapterError with the bad path in the message", async () => {
    await expect(
      runSession(
        {
          tools: ["read"],
          systemPrompt: "test",
          provider: "openrouter",
          modelId: "google/gemini-2.5-flash-lite",
          additionalExtensionPaths: ["/definitely/does/not/exist.ts"],
        },
        "noop",
        process.cwd(),
      ),
    ).rejects.toMatchObject({
      name: "PiAdapterError",
      message: expect.stringContaining("/definitely/does/not/exist.ts"),
    });
  });
});
