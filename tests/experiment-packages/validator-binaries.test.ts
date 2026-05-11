import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isBinaryOnPath } from "@facet/core/validator/binaries.js";
import { loadSpec } from "@facet/core/spec/loader.js";
import { validateSpec } from "@facet/core/validator/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const helloWorldPackage = path.join(repoRoot, "examples/hello-world-experiment");
const presetProfileDir = path.join(
  repoRoot,
  "packages/preset-pi-default/profile",
);

// Bullet 14.2 — `examples/hello-world-experiment` references the
// profile by npm name now. To keep these binary-preflight tests
// modifying `<pkg>/profiles/default/extensions.yaml` in-place, the
// clone helper copies the preset profile back into the tmpdir and
// rewrites the spec to point at the relative path.
async function clonePackage(src: string, dest: string): Promise<void> {
  await cp(src, dest, { recursive: true });
  await cp(presetProfileDir, path.join(dest, "profiles/default"), {
    recursive: true,
  });
  const specPath = path.join(dest, "spec.yaml");
  const raw = await readFile(specPath, "utf8");
  const patched = raw.replace(
    /ref: "@facet\/preset-pi-default"\s+hash: "sha256:[0-9a-f]+"/,
    'ref: "profiles/default"\n        hash: "TBD"',
  );
  await writeFile(specPath, patched, "utf8");
}

async function patchScenarioMeta(
  pkgRoot: string,
  scenarioRef: string,
  patch: (raw: string) => string,
): Promise<void> {
  const metaPath = path.join(pkgRoot, scenarioRef, "meta.yaml");
  const raw = await readFile(metaPath, "utf8");
  await writeFile(metaPath, patch(raw), "utf8");
}

describe("isBinaryOnPath", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "facet-bin-"));
    await writeFile(path.join(tmp, "fakebin"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  });

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns true when the binary file exists in a PATH directory", () => {
    expect(isBinaryOnPath("fakebin", tmp)).toBe(true);
  });

  it("returns false when the binary is not in any PATH directory", () => {
    expect(isBinaryOnPath("definitely-not-a-real-binary-xyz", tmp)).toBe(false);
  });

  it("returns false for an empty PATH", () => {
    expect(isBinaryOnPath("fakebin", "")).toBe(false);
  });

  it("returns false when PATH is undefined", () => {
    expect(isBinaryOnPath("fakebin", undefined)).toBe(false);
  });

  it("ignores empty path segments and finds the binary in a later segment", () => {
    const padded = `::${tmp}::`;
    expect(isBinaryOnPath("fakebin", padded)).toBe(true);
  });
});

describe("validateSpec — binary preflight", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "facet-valbin-"));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns OK for a package with no binary requirements (hello-world)", async () => {
    const spec = await loadSpec(path.join(helloWorldPackage, "spec.yaml"));
    const result = await validateSpec(spec, helloWorldPackage, {
      checkBinaries: true,
      pathEnv: "",
    });
    expect(result.ok).toBe(true);
    // Hello-world ships with `hash: "TBD"` on both its scenario and profile;
    // after Bullet 7.3 the validator emits two warnings for that. They are
    // not errors — `result.ok` is still true — so the binary-preflight
    // tests assert only that no error-severity issues surfaced.
    const errors = result.issues.filter(
      (i) => (i.severity ?? "error") === "error",
    );
    expect(errors).toEqual([]);
  });

  it("reports a missing scenario binary and includes the binary name", async () => {
    const pkg = path.join(tmpRoot, "missing-scenario-bin");
    await clonePackage(helloWorldPackage, pkg);
    await patchScenarioMeta(pkg, "scenarios/fizzbuzz-off-by-one", (raw) =>
      raw + 'requires_binaries: ["definitely-not-a-real-binary-xyz"]\n',
    );

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg, {
      checkBinaries: true,
      pathEnv: "",
    });

    expect(result.ok).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("binary-missing");
    const missing = result.issues.find((i) => i.code === "binary-missing");
    expect(missing?.message).toContain("definitely-not-a-real-binary-xyz");
    expect(missing?.message).toContain("scenario fizzbuzz-off-by-one");
  });

  it("reports a missing profile binary from extensions.yaml", async () => {
    const pkg = path.join(tmpRoot, "missing-profile-bin");
    await clonePackage(helloWorldPackage, pkg);
    await writeFile(
      path.join(pkg, "profiles/default/extensions.yaml"),
      'requires_binaries: ["fake-profile-binary-abc"]\n',
      "utf8",
    );

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg, {
      checkBinaries: true,
      pathEnv: "",
    });

    expect(result.ok).toBe(false);
    const missing = result.issues.find(
      (i) => i.code === "binary-missing" && i.message.includes("fake-profile-binary-abc"),
    );
    expect(missing).toBeDefined();
    expect(missing?.message).toContain("profile default");
  });

  it("reports a missing per-scenario binary from extensions.yaml", async () => {
    const pkg = path.join(tmpRoot, "missing-per-scenario-bin");
    await clonePackage(helloWorldPackage, pkg);
    await writeFile(
      path.join(pkg, "profiles/default/extensions.yaml"),
      [
        "requires_binaries_per_scenario:",
        '  fizzbuzz-off-by-one: ["fake-scoped-binary-def"]',
        "",
      ].join("\n"),
      "utf8",
    );

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg, {
      checkBinaries: true,
      pathEnv: "",
    });

    expect(result.ok).toBe(false);
    const missing = result.issues.find(
      (i) => i.code === "binary-missing" && i.message.includes("fake-scoped-binary-def"),
    );
    expect(missing).toBeDefined();
    expect(missing?.message).toContain("scenario fizzbuzz-off-by-one");
  });

  it("reports a missing language_servers binary derived from profile-lsp style config", async () => {
    const pkg = path.join(tmpRoot, "missing-language-server");
    await clonePackage(helloWorldPackage, pkg);
    await writeFile(
      path.join(pkg, "profiles/default/extensions.yaml"),
      [
        "language_servers:",
        '  fizzbuzz-off-by-one: "fake-language-server-ghi"',
        "",
      ].join("\n"),
      "utf8",
    );

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg, {
      checkBinaries: true,
      pathEnv: "",
    });

    expect(result.ok).toBe(false);
    const missing = result.issues.find(
      (i) =>
        i.code === "binary-missing" &&
        i.message.includes("fake-language-server-ghi"),
    );
    expect(missing).toBeDefined();
  });

  it("aggregates multiple missing binaries into separate issues, sorted", async () => {
    const pkg = path.join(tmpRoot, "multi-missing");
    await clonePackage(helloWorldPackage, pkg);
    await patchScenarioMeta(pkg, "scenarios/fizzbuzz-off-by-one", (raw) =>
      raw + 'requires_binaries: ["zzz-missing", "aaa-missing"]\n',
    );

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg, {
      checkBinaries: true,
      pathEnv: "",
    });

    expect(result.ok).toBe(false);
    const missing = result.issues.filter((i) => i.code === "binary-missing");
    expect(missing).toHaveLength(2);
    expect(missing[0]?.message).toContain("aaa-missing");
    expect(missing[1]?.message).toContain("zzz-missing");
  });

  it("dedupes the same binary required by multiple origins into one issue", async () => {
    const pkg = path.join(tmpRoot, "dedupe");
    await clonePackage(helloWorldPackage, pkg);
    await patchScenarioMeta(pkg, "scenarios/fizzbuzz-off-by-one", (raw) =>
      raw + 'requires_binaries: ["shared-fake-bin"]\n',
    );
    await writeFile(
      path.join(pkg, "profiles/default/extensions.yaml"),
      'requires_binaries: ["shared-fake-bin"]\n',
      "utf8",
    );

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg, {
      checkBinaries: true,
      pathEnv: "",
    });

    const missing = result.issues.filter((i) => i.code === "binary-missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain("shared-fake-bin");
    expect(missing[0]?.message).toContain("scenario fizzbuzz-off-by-one");
    expect(missing[0]?.message).toContain("profile default");
  });

  it("checkBinaries: false short-circuits the binary check", async () => {
    const pkg = path.join(tmpRoot, "no-check");
    await clonePackage(helloWorldPackage, pkg);
    await patchScenarioMeta(pkg, "scenarios/fizzbuzz-off-by-one", (raw) =>
      raw + 'requires_binaries: ["definitely-not-a-real-binary-xyz"]\n',
    );

    const spec = await loadSpec(path.join(pkg, "spec.yaml"));
    const result = await validateSpec(spec, pkg, {
      checkBinaries: false,
      pathEnv: "",
    });

    expect(result.ok).toBe(true);
    // Hello-world ships with `hash: "TBD"` on both its scenario and profile;
    // after Bullet 7.3 the validator emits two warnings for that. They are
    // not errors — `result.ok` is still true — so the binary-preflight
    // tests assert only that no error-severity issues surfaced.
    const errors = result.issues.filter(
      (i) => (i.severity ?? "error") === "error",
    );
    expect(errors).toEqual([]);
  });

  it("finds a binary present in the supplied PATH and validates OK", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "facet-pathok-"));
    try {
      await writeFile(path.join(tmp, "real-fake-bin"), "#!/bin/sh\n", { mode: 0o755 });

      const pkg = path.join(tmpRoot, "pathok");
      await clonePackage(helloWorldPackage, pkg);
      await patchScenarioMeta(pkg, "scenarios/fizzbuzz-off-by-one", (raw) =>
        raw + 'requires_binaries: ["real-fake-bin"]\n',
      );

      const spec = await loadSpec(path.join(pkg, "spec.yaml"));
      const result = await validateSpec(spec, pkg, {
        checkBinaries: true,
        pathEnv: tmp,
      });

      expect(result.ok).toBe(true);
      const errors = result.issues.filter(
        (i) => (i.severity ?? "error") === "error",
      );
      expect(errors).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
