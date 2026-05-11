import { describe, expect, it } from "vitest";

import { getInstalledPiVersion } from "@facet/harness-pi/version";

import {
  compareSemverParts,
  getInstalledFrameworkVersion,
  mixSeed,
  parseSemverParts,
} from "@facet/core/runner/version.js";

describe("parseSemverParts", () => {
  it("parses x.y.z", () => {
    expect(parseSemverParts("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });
  it("ignores pre-release / build suffix", () => {
    expect(parseSemverParts("0.70.0-rc.1")).toEqual({ major: 0, minor: 70, patch: 0 });
    expect(parseSemverParts("1.0.0+build.5")).toEqual({ major: 1, minor: 0, patch: 0 });
  });
  it("returns undefined for unparseable strings", () => {
    expect(parseSemverParts("unknown")).toBeUndefined();
    expect(parseSemverParts("")).toBeUndefined();
    expect(parseSemverParts("v1.2")).toBeUndefined();
  });
});

describe("compareSemverParts", () => {
  it("returns equal for identical versions", () => {
    expect(compareSemverParts("0.1.0", "0.1.0")).toBe("equal");
  });
  it("returns patch when only patch differs", () => {
    expect(compareSemverParts("0.1.0", "0.1.1")).toBe("patch");
  });
  it("returns minor when minor differs", () => {
    expect(compareSemverParts("0.1.0", "0.2.0")).toBe("minor");
  });
  it("returns major when major differs (hard failure for cross-check)", () => {
    expect(compareSemverParts("0.1.0", "1.0.0")).toBe("major");
    expect(compareSemverParts("999.0.0", "0.1.0")).toBe("major");
  });
  it("returns unparseable when either side fails to parse", () => {
    expect(compareSemverParts("unknown", "0.1.0")).toBe("unparseable");
    expect(compareSemverParts("0.1.0", "")).toBe("unparseable");
  });
});

describe("getInstalledFrameworkVersion", () => {
  it("resolves to the version from this package's package.json", () => {
    const v = getInstalledFrameworkVersion();
    expect(v).not.toBe("unknown");
    expect(parseSemverParts(v)).toBeDefined();
  });
});

describe("getInstalledPiVersion", () => {
  it("resolves to the installed pi-coding-agent version", () => {
    const v = getInstalledPiVersion();
    expect(v).not.toBe("unknown");
    expect(parseSemverParts(v)).toBeDefined();
  });
});

describe("mixSeed", () => {
  it("is deterministic for the same inputs", () => {
    expect(mixSeed(42, "run-0001")).toBe(mixSeed(42, "run-0001"));
  });
  it("differs across run ids", () => {
    expect(mixSeed(42, "run-0001")).not.toBe(mixSeed(42, "run-0002"));
  });
  it("differs across spec seeds", () => {
    expect(mixSeed(42, "run-0001")).not.toBe(mixSeed(43, "run-0001"));
  });
  it("returns a non-negative 32-bit integer", () => {
    const value = mixSeed(2 ** 30, "run-9999");
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(2 ** 32);
    expect(Number.isInteger(value)).toBe(true);
  });
});
