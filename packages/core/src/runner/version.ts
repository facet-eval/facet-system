// Reproducibility plumbing helpers (Phase 7 / R5).
//
// Pure functions that resolve installed framework + Pi versions, compare
// SemVer parts, and capture git provenance. Kept dep-free so a future
// `facet doctor` or replay tool can import them without dragging in the
// rest of the runner. Side effects are limited to filesystem reads and
// one `git` subprocess in `gitProvenance`.

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SemverDifference =
  | "equal"
  | "patch"
  | "minor"
  | "major"
  | "unparseable";

export interface SemverParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)/;

/**
 * Parse a semver-like string into `{major, minor, patch}`. Pre-release and
 * build suffixes are ignored — the caller usually only cares about
 * major/minor/patch differences for the version cross-check. Returns
 * `undefined` when the string cannot be parsed.
 */
export function parseSemverParts(version: string): SemverParts | undefined {
  const match = SEMVER_RE.exec(version);
  if (match === null) return undefined;
  const [, majorStr, minorStr, patchStr] = match;
  return {
    major: Number.parseInt(majorStr!, 10),
    minor: Number.parseInt(minorStr!, 10),
    patch: Number.parseInt(patchStr!, 10),
  };
}

/**
 * Compare a declared version against an installed version.
 * Returns "major" if the major part differs (hard failure for the
 * cross-check), "minor"/"patch" for less-severe drift (warning),
 * "equal" when identical, and "unparseable" when either side fails
 * to parse. The caller decides which severity to apply.
 */
export function compareSemverParts(
  declared: string,
  installed: string,
): SemverDifference {
  const d = parseSemverParts(declared);
  const i = parseSemverParts(installed);
  if (d === undefined || i === undefined) return "unparseable";
  if (d.major !== i.major) return "major";
  if (d.minor !== i.minor) return "minor";
  if (d.patch !== i.patch) return "patch";
  return "equal";
}

/**
 * Read the installed framework version from this package's `package.json`.
 * Walks up from this module to the nearest `package.json` whose `name`
 * looks like the FACET package (any name ending in `/facet`). Returns
 * `"unknown"` if no match is found — the version cross-check will emit
 * a warning rather than failing the run.
 */
export function getInstalledFrameworkVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  while (true) {
    const candidate = path.join(dir, "package.json");
    try {
      const raw = readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
      if (
        typeof parsed.name === "string" &&
        (parsed.name === "@facet/core" || parsed.name.endsWith("/facet")) &&
        typeof parsed.version === "string" &&
        parsed.version.length > 0
      ) {
        return parsed.version;
      }
    } catch {
      // not here, walk up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "unknown";
}

// Bullet 13.1: `getInstalledPiVersion` moved to
// `@facet/harness-pi/version`. Callers (validator, manifest, runner)
// import it from there. Phase 13.2 eliminates it entirely once
// `metadata.harness` lookup feeds the validator/manifest from the
// registered HarnessAdapter's `version` field.

export interface GitProvenance {
  readonly commit: string;
  readonly dirty: boolean;
}

/**
 * Capture the current git commit + dirty flag. Returns `{commit: "unknown",
 * dirty: false}` if `git` is missing, the cwd is not a repo, or any
 * subprocess fails — provenance is best-effort and must not abort a run.
 */
export function gitProvenance(cwd: string = process.cwd()): GitProvenance {
  const opts: ExecFileSyncOptionsWithStringEncoding = {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  };
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], opts).trim();
  } catch {
    return { commit: "unknown", dirty: false };
  }
  let dirty = false;
  try {
    const status = execFileSync("git", ["status", "--porcelain"], opts);
    dirty = status.trim().length > 0;
  } catch {
    // fall through with dirty=false
  }
  return { commit, dirty };
}

/**
 * Derive a per-run seed from the spec seed + run id. FNV-32 with XOR
 * folding — fast, dependency-free, deterministic across platforms. The
 * derived seed is recorded for traceability; today's Pi sessions are
 * not seedable from outside the SDK, so this is intent capture, not
 * actual session-level determinism. Documented as such in NOTES.
 */
export function mixSeed(specSeed: number, runId: string): number {
  let h = (specSeed >>> 0) ^ 0x811c9dc5; // FNV offset basis xor specSeed
  for (let i = 0; i < runId.length; i += 1) {
    h ^= runId.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h >>> 0;
}
