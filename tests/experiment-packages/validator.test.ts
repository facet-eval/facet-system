import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec } from "@facet/core/spec/loader.js";
import { validateSpec } from "@facet/core/validator/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const examplePackage = path.join(repoRoot, "examples/hello-world-experiment");
const presetProfileDir = path.join(
  repoRoot,
  "packages/preset-pi-default/profile",
);

// Bullet 14.2 — the canonical hello-world example now references the
// preset by npm name (`@facet/preset-pi-default`). For tests that mutate
// the profile in-place (extensions.yaml, etc.) it is simpler to clone
// the preset's profile back into the tmpdir as `profiles/default/` and
// rewrite the spec's profile ref to that relative path. The two test
// paths that exercise the preset directly (mismatch + match) opt out by
// passing `keepNpmRef: true`.
async function cloneExample(
  dest: string,
  opts: { keepNpmRef?: boolean } = {},
): Promise<void> {
  await cp(examplePackage, dest, { recursive: true });
  if (opts.keepNpmRef === true) return;
  const localProfileDir = path.join(dest, "profiles/default");
  await cp(presetProfileDir, localProfileDir, { recursive: true });
  const specPath = path.join(dest, "spec.yaml");
  const raw = await readFile(specPath, "utf8");
  const patched = raw.replace(
    /ref: "@facet\/preset-pi-default"\s+hash: "sha256:[0-9a-f]+"/,
    'ref: "profiles/default"\n        hash: "TBD"',
  );
  await writeFile(specPath, patched, "utf8");
}

describe("validateSpec", () => {
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "facet-val-"));
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns OK for the canonical hello-world example (TBD scenario hash allowed)", async () => {
    const spec = await loadSpec(path.join(examplePackage, "spec.yaml"));
    const result = await validateSpec(spec, examplePackage);
    expect(result.ok).toBe(true);
    // Bullet 14.2 — the hello-world spec now references the profile by
    // npm name (`@facet/preset-pi-default`) with a locked hash, so the
    // pre-Phase-14 `profile-hash-tbd` warning is gone. Only the scenario
    // still carries `hash: "TBD"` (Phase 14.3 ports scenarios next).
    const errors = result.issues.filter(
      (i) => (i.severity ?? "error") === "error",
    );
    expect(errors).toEqual([]);
    const codes = result.issues.map((i) => i.code).sort();
    expect(codes).toEqual(["scenario-hash-tbd"]);
  });

  it("reports a clear issue when a scenario does not declare a required prompt_id", async () => {
    const pkg = path.join(tmpRoot, "missing-prompt");
    await cloneExample(pkg);

    const metaPath = path.join(
      pkg,
      "scenarios/fizzbuzz-off-by-one/meta.yaml",
    );
    // Rewrite meta.yaml so it only declares `underspecified`, not `specific`.
    const pruned = `id: fizzbuzz-off-by-one
language: typescript
task_type: bug_fix
difficulty: trivial
tags: [greenfield]
prompts:
  - id: underspecified
    file: prompts/underspecified.md
`;
    await writeFile(metaPath, pruned, "utf8");

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg);

    expect(result.ok).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("scenario-missing-prompt");
    const missing = result.issues.find(
      (i) => i.code === "scenario-missing-prompt",
    );
    expect(missing?.message).toMatch(/specific/);
  });

  it("reports a clear issue when a scenario ref points to a non-existent directory", async () => {
    const pkg = path.join(tmpRoot, "bad-ref");
    await cloneExample(pkg);

    // Rewrite spec.yaml to point the scenario at a directory that does not exist.
    const specPath = path.join(pkg, "spec.yaml");
    const raw = await (await import("node:fs/promises")).readFile(
      specPath,
      "utf8",
    );
    const patched = raw.replace(
      `ref: "scenarios/fizzbuzz-off-by-one"`,
      `ref: "scenarios/does-not-exist"`,
    );
    await writeFile(specPath, patched, "utf8");

    const spec = await loadSpec(specPath);
    const result = await validateSpec(spec, pkg);

    expect(result.ok).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("scenario-ref-missing");
    const missing = result.issues.find(
      (i) => i.code === "scenario-ref-missing",
    );
    expect(missing?.message).toMatch(/does-not-exist/);
  });

  it("emits scenario-prompts-empty when meta.yaml has no prompts: key (B-01)", async () => {
    const pkg = path.join(tmpRoot, "no-prompts-key");
    await cloneExample(pkg);

    const metaPath = path.join(
      pkg,
      "scenarios/fizzbuzz-off-by-one/meta.yaml",
    );
    // No prompts key at all. Pre-fix this validated as OK (with prompts
    // defaulted to []) and crashed at facet-run time. Post-fix it must
    // surface as a deterministic validator error.
    const noPromptsKey = `id: fizzbuzz-off-by-one
language: typescript
task_type: bug_fix
difficulty: trivial
tags: [greenfield]
`;
    await writeFile(metaPath, noPromptsKey, "utf8");

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg);

    expect(result.ok).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("scenario-prompts-empty");
    const empty = result.issues.find((i) => i.code === "scenario-prompts-empty");
    expect(empty?.message).toMatch(/fizzbuzz-off-by-one/);
    expect(empty?.message).toMatch(/at least one prompt/);
    // It must NOT also emit the generic scenario-meta-invalid for the
    // same scenario; the targeted code is the whole point.
    expect(codes).not.toContain("scenario-meta-invalid");
  });

  it("emits scenario-prompts-empty when prompts: is an empty list (B-01)", async () => {
    const pkg = path.join(tmpRoot, "empty-prompts");
    await cloneExample(pkg);

    const metaPath = path.join(
      pkg,
      "scenarios/fizzbuzz-off-by-one/meta.yaml",
    );
    const emptyPromptsList = `id: fizzbuzz-off-by-one
language: typescript
task_type: bug_fix
difficulty: trivial
tags: [greenfield]
prompts: []
`;
    await writeFile(metaPath, emptyPromptsList, "utf8");

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg);

    expect(result.ok).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("scenario-prompts-empty");
  });

  it("emits an extensions-unknown-key WARNING (severity warning, ok stays true) for unknown top-level keys (Bullet 2.2)", async () => {
    const pkg = path.join(tmpRoot, "ext-unknown-top-warn");
    await cloneExample(pkg);
    // hello-world's `profiles/default` has no extensions.yaml; create one
    // with an unknown top-level key. `experimental_field` is not in
    // KNOWN_EXTENSIONS_KEYS — change this fixture if a future bullet
    // adds it as a real key (the same way Bullet 4.1 added `metrics:`).
    await writeFile(
      path.join(pkg, "profiles/default/extensions.yaml"),
      "experimental_field:\n  enabled: true\n",
      "utf8",
    );

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg, { checkBinaries: false });

    expect(result.ok).toBe(true);
    const warning = result.issues.find(
      (i) => i.code === "extensions-unknown-key",
    );
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain("experimental_field");
  });

  it("FACET_STRICT_SCHEMA=true promotes the unknown-key warning to an error", async () => {
    const pkg = path.join(tmpRoot, "ext-unknown-top-strict");
    await cloneExample(pkg);
    await writeFile(
      path.join(pkg, "profiles/default/extensions.yaml"),
      "future_field:\n  enabled: true\n",
      "utf8",
    );

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg, {
      checkBinaries: false,
      strictSchema: true,
    });

    expect(result.ok).toBe(false);
    const promoted = result.issues.find(
      (i) => i.code === "extensions-unknown-key",
    );
    expect(promoted).toBeDefined();
    expect(promoted?.severity).toBe("error");
  });

  it("emits upfront-command-missing when the declared command is not on PATH (Bullet 5.3)", async () => {
    const pkg = path.join(tmpRoot, "upfront-bad-cmd");
    await cloneExample(pkg);
    await writeFile(
      path.join(pkg, "profiles/default/extensions.yaml"),
      `upfront_context:
  - applies_to_scenarios: ["fizzbuzz-off-by-one"]
    command: "definitely-not-on-path-cli-12345"
    args: ["--help"]
    cwd: "\${WORKSPACE}"
    header: "## Test"
`,
      "utf8",
    );

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg, {
      checkBinaries: false,
      pathEnv: "/nonexistent",
    });
    expect(result.issues.find((i) => i.code === "upfront-command-missing"))
      .toBeDefined();
  });

  it("emits upfront-script-missing when first arg is a relative script path that doesn't exist (Bullet 5.3)", async () => {
    const pkg = path.join(tmpRoot, "upfront-missing-script");
    await cloneExample(pkg);
    await writeFile(
      path.join(pkg, "profiles/default/extensions.yaml"),
      `upfront_context:
  - applies_to_scenarios: ["fizzbuzz-off-by-one"]
    command: "bash"
    args: ["upfront/missing.sh"]
    cwd: "\${WORKSPACE}"
    header: "## Test"
`,
      "utf8",
    );

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg, { checkBinaries: false });
    expect(result.issues.find((i) => i.code === "upfront-script-missing"))
      .toBeDefined();
  });

  it("emits pinned-agents-empty when source_dir has no .md files (Bullet 5.3)", async () => {
    // Bullet 16.2 — the `pinned_agents` schema moved to harness-pi as a
    // strict `ExtensionsContribution` that requires every field
    // explicitly (the old `.default()` calls produced an input/output
    // type asymmetry incompatible with the SDK's `ZodType<TValue>`
    // contract). Include all three fields here; the preflight that
    // emits `pinned-agents-empty` runs after the schema accepts the
    // value.
    const pkg = path.join(tmpRoot, "pinned-agents-empty");
    await cloneExample(pkg);
    await writeFile(
      path.join(pkg, "profiles/default/extensions.yaml"),
      `pinned_agents:
  source_dir: "agents"
  model_placeholder: "\${RUN_MODEL}"
  inherit_user_models_json: false
`,
      "utf8",
    );

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg, { checkBinaries: false });
    expect(result.issues.find((i) => i.code === "pinned-agents-empty"))
      .toBeDefined();
  });

  it("aborts with scenario-hash-mismatch when the spec declares a hash that does not match the on-disk content (Bullet 7.3)", async () => {
    const pkg = path.join(tmpRoot, "scenario-hash-mismatch");
    await cloneExample(pkg);
    const specPath = path.join(pkg, "spec.yaml");
    const raw = await (await import("node:fs/promises")).readFile(specPath, "utf8");
    // Replace the scenario hash (currently "TBD") with a real-looking but
    // wrong sha256. The validator should hash the on-disk content and
    // emit scenario-hash-mismatch as a hard error.
    const wrongHash =
      "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    const patched = raw.replace(
      /(scenarios:\n[\s\S]*?ref: "scenarios\/fizzbuzz-off-by-one"\n\s+hash: ")[^"]+(")/,
      `$1${wrongHash}$2`,
    );
    expect(patched).not.toBe(raw);
    await writeFile(specPath, patched, "utf8");
    const spec = await loadSpec(specPath);
    const result = await validateSpec(spec, pkg, { checkBinaries: false });
    expect(result.ok).toBe(false);
    const mismatch = result.issues.find(
      (i) => i.code === "scenario-hash-mismatch",
    );
    expect(mismatch).toBeDefined();
    expect((mismatch?.severity ?? "error")).toBe("error");
  });

  it("aborts with framework-version-major-mismatch when the spec declares a major-incompatible framework_version (Bullet 7.2)", async () => {
    const pkg = path.join(tmpRoot, "framework-version-major");
    await cloneExample(pkg);

    const specPath = path.join(pkg, "spec.yaml");
    const raw = await (await import("node:fs/promises")).readFile(specPath, "utf8");
    const patched = raw.replace(
      /framework_version: ".+"/,
      `framework_version: "999.0.0"`,
    );
    await writeFile(specPath, patched, "utf8");

    const spec = await loadSpec(specPath);
    const result = await validateSpec(spec, pkg, { checkBinaries: false });
    expect(result.ok).toBe(false);
    const issue = result.issues.find(
      (i) => i.code === "framework-version-major-mismatch",
    );
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("999.0.0");
  });

  it("emits a framework-version-minor-mismatch WARNING (severity warning, ok stays true) when only minor/patch differs (Bullet 7.2)", async () => {
    const pkg = path.join(tmpRoot, "framework-version-minor");
    await cloneExample(pkg);

    const specPath = path.join(pkg, "spec.yaml");
    const raw = await (await import("node:fs/promises")).readFile(specPath, "utf8");
    // Same major as installed (0.x), different minor.
    const patched = raw.replace(
      /framework_version: ".+"/,
      `framework_version: "0.99.0"`,
    );
    await writeFile(specPath, patched, "utf8");

    const spec = await loadSpec(specPath);
    const result = await validateSpec(spec, pkg, { checkBinaries: false });
    const issue = result.issues.find(
      (i) => i.code === "framework-version-minor-mismatch",
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    expect(result.ok).toBe(true);
  });

  it("reports a clear issue when a profile ref points to a non-existent directory", async () => {
    const pkg = path.join(tmpRoot, "bad-profile-ref");
    await cloneExample(pkg);

    const specPath = path.join(pkg, "spec.yaml");
    const raw = await (await import("node:fs/promises")).readFile(
      specPath,
      "utf8",
    );
    const patched = raw.replace(`ref: "profiles/default"`, `ref: "profiles/missing"`);
    await writeFile(specPath, patched, "utf8");

    const spec = await loadSpec(specPath);
    const result = await validateSpec(spec, pkg);

    expect(result.ok).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("profile-ref-missing");
  });

  // Bullet 14.1 — preset-harness-mismatch is emitted when the spec
  // declares a different harness than the preset's package.json#facet.
  it("rejects an npm-shaped preset whose package.json declares a different harness", async () => {
    const { mkdir } = await import("node:fs/promises");
    const pkg = path.join(tmpRoot, "preset-harness-mismatch");
    await cloneExample(pkg);
    // Stand up a fake preset under `node_modules` relative to the
    // experiment package so the loader's `findInstalledPackageRoot`
    // discovers it via the upward walk from `packageRoot`.
    const presetRoot = path.join(pkg, "node_modules", "@fake/preset-other");
    await mkdir(path.join(presetRoot, "profile"), { recursive: true });
    await writeFile(
      path.join(presetRoot, "package.json"),
      JSON.stringify({
        name: "@fake/preset-other",
        version: "1.0.0",
        facet: {
          profileRoot: "./profile",
          harness: "@other/harness",
          harnessVersionRange: "*",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(presetRoot, "profile", "SYSTEM.md"),
      "# fake\n",
      "utf8",
    );
    // Rewrite the spec to swap the relative profile ref for the preset.
    const specPath = path.join(pkg, "spec.yaml");
    const raw = await (await import("node:fs/promises")).readFile(
      specPath,
      "utf8",
    );
    const patched = raw.replace(
      `ref: "profiles/default"`,
      `ref: "@fake/preset-other"`,
    );
    await writeFile(specPath, patched, "utf8");

    const spec = await loadSpec(specPath);
    const result = await validateSpec(spec, pkg, { checkBinaries: false });
    expect(result.ok).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("preset-harness-mismatch");
  });

  it("accepts an npm-shaped preset whose facet block agrees with the spec", async () => {
    const { mkdir } = await import("node:fs/promises");
    const pkg = path.join(tmpRoot, "preset-harness-match");
    await cloneExample(pkg);
    const presetRoot = path.join(pkg, "node_modules", "@fake/preset-ok");
    await mkdir(path.join(presetRoot, "profile"), { recursive: true });
    // Make the preset's profile/ a self-contained mini profile so the
    // downstream loaders (tools.yaml, extensions.yaml) gracefully skip.
    await writeFile(
      path.join(presetRoot, "package.json"),
      JSON.stringify({
        name: "@fake/preset-ok",
        version: "1.0.0",
        facet: {
          profileRoot: "./profile",
          harness: "@facet/harness-pi",
          harnessVersionRange: "*",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(presetRoot, "profile", "SYSTEM.md"),
      "# fake\n",
      "utf8",
    );
    const specPath = path.join(pkg, "spec.yaml");
    const raw = await (await import("node:fs/promises")).readFile(
      specPath,
      "utf8",
    );
    const patched = raw.replace(
      `ref: "profiles/default"`,
      `ref: "@fake/preset-ok"`,
    );
    await writeFile(specPath, patched, "utf8");

    const spec = await loadSpec(specPath);
    const result = await validateSpec(spec, pkg, { checkBinaries: false });
    const codes = result.issues.map((i) => i.code);
    expect(codes).not.toContain("preset-harness-mismatch");
    expect(codes).not.toContain("preset-load-failed");
  });
});
