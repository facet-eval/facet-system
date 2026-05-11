import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ProfilePackageLoadError,
  checkPresetCompatibility,
  loadProfilePackage,
} from "@facet/core/profile-package/loader.js";

// Bullet 14.1 — `loadProfilePackage` resolves npm-style refs by walking
// up `node_modules` from the experiment package, and relative refs by
// path resolution. `checkPresetCompatibility` produces validator codes
// `preset-harness-mismatch` / `preset-hash-mismatch` when the preset's
// `package.json#facet` disagrees with the experiment spec.

interface FakePresetOptions {
  readonly packageName: string;
  readonly version: string;
  readonly harness: string;
  readonly harnessVersionRange: string;
  readonly hash?: string;
  readonly profileFiles?: Record<string, string>;
}

async function writeFakePreset(
  nodeModulesDir: string,
  opts: FakePresetOptions,
): Promise<string> {
  const presetRoot = path.join(nodeModulesDir, opts.packageName);
  const profileDir = path.join(presetRoot, "profile");
  await mkdir(profileDir, { recursive: true });
  const facet: Record<string, unknown> = {
    profileRoot: "./profile",
    harness: opts.harness,
    harnessVersionRange: opts.harnessVersionRange,
  };
  if (opts.hash !== undefined) facet.hash = opts.hash;
  await writeFile(
    path.join(presetRoot, "package.json"),
    JSON.stringify(
      { name: opts.packageName, version: opts.version, facet },
      null,
      2,
    ),
    "utf8",
  );
  const files = opts.profileFiles ?? { "SYSTEM.md": "# fake\n" };
  for (const [rel, body] of Object.entries(files)) {
    await writeFile(path.join(profileDir, rel), body, "utf8");
  }
  return presetRoot;
}

describe("loadProfilePackage", () => {
  let tmpRoot: string;
  let contextDir: string;
  let nodeModules: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "facet-preset-"));
    contextDir = path.join(tmpRoot, "experiment");
    nodeModules = path.join(tmpRoot, "node_modules");
    await mkdir(contextDir, { recursive: true });
    await mkdir(nodeModules, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("resolves an npm-style ref by walking up node_modules", async () => {
    await writeFakePreset(nodeModules, {
      packageName: "@fake/preset-pi-foo",
      version: "1.2.3",
      harness: "@facet/harness-pi",
      harnessVersionRange: "^0.70",
      hash: "deadbeef",
    });
    const parsed = await loadProfilePackage(
      "@fake/preset-pi-foo",
      contextDir,
    );
    expect(parsed.packageName).toBe("@fake/preset-pi-foo");
    expect(parsed.packageVersion).toBe("1.2.3");
    expect(parsed.profilePath.endsWith(path.join("@fake/preset-pi-foo", "profile"))).toBe(
      true,
    );
    expect(parsed.manifest.harness).toBe("@facet/harness-pi");
    expect(parsed.manifest.hash).toBe("deadbeef");
  });

  it("resolves a relative ref against contextDir without consulting package.json#facet", async () => {
    const profileDir = path.join(contextDir, "profiles", "default");
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, "SYSTEM.md"), "# local\n", "utf8");
    const parsed = await loadProfilePackage(
      "./profiles/default",
      contextDir,
    );
    expect(parsed.profilePath).toBe(profileDir);
    expect(parsed.manifest.harness).toBe("(relative-skip-check)");
  });

  it("fails with ProfilePackageLoadError when the npm package is not installed", async () => {
    await expect(
      loadProfilePackage("@fake/missing", contextDir),
    ).rejects.toThrow(ProfilePackageLoadError);
  });

  it("fails when the preset's package.json has no facet block", async () => {
    const presetRoot = path.join(nodeModules, "@fake/bad");
    await mkdir(path.join(presetRoot, "profile"), { recursive: true });
    await writeFile(
      path.join(presetRoot, "package.json"),
      JSON.stringify({ name: "@fake/bad", version: "0.0.1" }),
      "utf8",
    );
    await expect(
      loadProfilePackage("@fake/bad", contextDir),
    ).rejects.toThrow(/has no `facet` block/);
  });

  it("fails when profileRoot resolves to a missing directory", async () => {
    const presetRoot = path.join(nodeModules, "@fake/empty");
    await mkdir(presetRoot, { recursive: true });
    await writeFile(
      path.join(presetRoot, "package.json"),
      JSON.stringify({
        name: "@fake/empty",
        version: "0.0.1",
        facet: {
          profileRoot: "./does-not-exist",
          harness: "@facet/harness-pi",
          harnessVersionRange: "*",
        },
      }),
      "utf8",
    );
    await expect(
      loadProfilePackage("@fake/empty", contextDir),
    ).rejects.toThrow(/profileRoot/);
  });
});

describe("checkPresetCompatibility", () => {
  it("returns no issues when harness and hash agree", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "facet-preset-compat-"));
    try {
      const nm = path.join(tmp, "node_modules");
      await mkdir(nm, { recursive: true });
      await writeFakePreset(nm, {
        packageName: "@fake/preset-ok",
        version: "1.0.0",
        harness: "@facet/harness-pi",
        harnessVersionRange: "^0.70",
        hash: "abc123",
      });
      const ctx = path.join(tmp, "experiment");
      await mkdir(ctx, { recursive: true });
      const parsed = await loadProfilePackage("@fake/preset-ok", ctx);
      expect(
        checkPresetCompatibility(parsed, "@facet/harness-pi", "abc123"),
      ).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("emits preset-harness-mismatch when the preset targets a different harness", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "facet-preset-compat-"));
    try {
      const nm = path.join(tmp, "node_modules");
      await mkdir(nm, { recursive: true });
      await writeFakePreset(nm, {
        packageName: "@fake/preset-other",
        version: "1.0.0",
        harness: "@other/harness",
        harnessVersionRange: "*",
      });
      const ctx = path.join(tmp, "experiment");
      await mkdir(ctx, { recursive: true });
      const parsed = await loadProfilePackage("@fake/preset-other", ctx);
      const issues = checkPresetCompatibility(parsed, "@facet/harness-pi", undefined);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("preset-harness-mismatch");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("emits preset-hash-mismatch when declared hash and manifest hash differ", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "facet-preset-compat-"));
    try {
      const nm = path.join(tmp, "node_modules");
      await mkdir(nm, { recursive: true });
      await writeFakePreset(nm, {
        packageName: "@fake/preset-hashed",
        version: "1.0.0",
        harness: "@facet/harness-pi",
        harnessVersionRange: "*",
        hash: "aaaa",
      });
      const ctx = path.join(tmp, "experiment");
      await mkdir(ctx, { recursive: true });
      const parsed = await loadProfilePackage("@fake/preset-hashed", ctx);
      const issues = checkPresetCompatibility(parsed, "@facet/harness-pi", "bbbb");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("preset-hash-mismatch");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("skips checks for relative refs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "facet-preset-rel-"));
    try {
      const ctx = path.join(tmp, "experiment");
      const profileDir = path.join(ctx, "profile");
      await mkdir(profileDir, { recursive: true });
      const parsed = await loadProfilePackage("./profile", ctx);
      expect(
        checkPresetCompatibility(parsed, "@facet/harness-pi", "anything"),
      ).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
