// Centralized bundle naming + run-dir patterns (Phase 10 / Bullet 10.4 — F-49).
//
// Pre-Phase-10 the bundle name format, the run-dir pattern, and the
// timestamp shape were scattered across `writer.ts`, `aggregate.ts`,
// and the test fixtures. Each consumer reimplemented the same string
// glue. This module is the single source of truth.

/**
 * Result bundle name shape: `result-<specId>-<UTC timestamp>`.
 * Timestamps follow RFC3339-flavoured `YYYYMMDDTHHMMSS` so the
 * lexicographic order matches the temporal order.
 */
export const BUNDLE_NAME_PREFIX = "result-";

/**
 * Per-run directory naming inside a bundle: `runs/run-NNNN/`. The
 * suffix is a 4-digit zero-padded integer.
 */
export const RUN_DIR_PREFIX = "run-";
export const RUN_DIR_PAD = 4;

/**
 * Matches a single per-run directory name (e.g. `run-0001`).
 * Anchored on both ends — callers feed `entry.name` from `readdir`.
 */
export const RUN_DIR_RE: RegExp = /^run-\d{4,}$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * UTC timestamp in `YYYYMMDDTHHMMSS` form. Used inside bundle names so
 * a directory listing sorts the bundles in temporal order.
 */
export function formatBundleTimestamp(date: Date = new Date()): string {
  return (
    date.getUTCFullYear().toString() +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    "T" +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds())
  );
}

/**
 * Full result-bundle directory name for a given spec id + timestamp.
 */
export function formatBundleName(specId: string, date: Date = new Date()): string {
  return `${BUNDLE_NAME_PREFIX}${specId}-${formatBundleTimestamp(date)}`;
}

/**
 * Per-run directory name for the 1-based ordinal `index`.
 */
export function formatRunId(index: number): string {
  return `${RUN_DIR_PREFIX}${String(index).padStart(RUN_DIR_PAD, "0")}`;
}

/**
 * Parse a bundle directory name back into its `{specId, timestamp}`
 * components. Returns `undefined` for names that do not follow the
 * `result-<specId>-<timestamp>` shape — callers should treat that as
 * "not a FACET bundle" rather than as an error.
 */
// ts-prune-ignore-next
export function parseBundleName(
  dirName: string,
): { readonly specId: string; readonly timestamp: string } | undefined {
  if (!dirName.startsWith(BUNDLE_NAME_PREFIX)) return undefined;
  // The timestamp is the trailing `YYYYMMDDTHHMMSS` segment (15 chars
  // including the literal `T`). Spec ids may legitimately contain dashes
  // (per the `metadata.id` schema), so we anchor on the timestamp shape
  // at the end of the name rather than splitting on `-`.
  const tsMatch = dirName.match(/-(\d{8}T\d{6})$/);
  if (tsMatch === null) return undefined;
  const timestamp = tsMatch[1]!;
  const specId = dirName.slice(
    BUNDLE_NAME_PREFIX.length,
    dirName.length - timestamp.length - 1, // -1 for the separator dash
  );
  if (specId.length === 0) return undefined;
  return { specId, timestamp };
}
