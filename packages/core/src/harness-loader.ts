// Bullet 16.3 — dynamic harness loading.
//
// `loadHarness(packageName, contextDir)` dynamically imports the harness
// package the spec declares in `metadata.harness.package`, reads its
// `default` export (the `HarnessAdapter` produced by `defineHarness`),
// and returns the adapter together with the optional `register(registries)`
// hook the harness uses to populate the runtime registries (metric
// kinds, extensions contributions, factor kinds, etc.).
//
// Refs follow the same classification rule as profile refs:
//   - starts with `@` (scoped) or is a bare unscoped name (no `/`, no
//     `.`) ⇒ npm package, resolved by Node's standard module
//     resolution from `contextDir`;
//   - everything else is treated as a local path relative to
//     `contextDir`.
//
// This is the only seam in the core that loads a harness. After
// Bullet 16.3 the runner / validator / manifest writer all consume
// the loaded adapter through their callers' threading — no
// `@facet/harness-pi` import survives in `packages/core/src/`.

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { HarnessAdapter } from "@facet/sdk/harness";

// ts-prune-ignore-next
export class HarnessLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HarnessLoadError";
  }
}

// ts-prune-ignore-next
export type HarnessRegisterFn = (registries: unknown) => void | Promise<void>;

// ts-prune-ignore-next
export interface LoadedHarness {
  readonly adapter: HarnessAdapter;
  readonly register?: HarnessRegisterFn;
}

function isNpmRef(ref: string): boolean {
  if (ref.startsWith("@")) return true;
  if (
    ref.startsWith("./") ||
    ref.startsWith("../") ||
    ref.startsWith("/") ||
    ref.startsWith("~/")
  ) {
    return false;
  }
  return !ref.includes("/");
}

function resolveLocalHarness(ref: string, contextDir: string): string {
  const absolute = path.resolve(contextDir, ref);
  if (existsSync(absolute)) return absolute;
  for (const ext of [".ts", ".js", ".mjs", "/index.ts", "/index.js", "/index.mjs"]) {
    const candidate = `${absolute}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  throw new HarnessLoadError(
    `Harness "${ref}" resolved to "${absolute}" but the file does not exist.`,
  );
}

interface HarnessModuleShape {
  readonly default?: HarnessAdapter;
  readonly register?: HarnessRegisterFn;
  // Some harnesses may export the adapter as a named export named after
  // the harness. The loader only accepts `default` — the convention is
  // tight on purpose so the runtime path is predictable.
}

// ts-prune-ignore-next
export async function loadHarness(
  packageName: string,
  contextDir: string,
): Promise<LoadedHarness> {
  let spec: string;
  if (isNpmRef(packageName)) {
    spec = packageName;
  } else {
    spec = pathToFileURL(resolveLocalHarness(packageName, contextDir)).toString();
  }
  let mod: HarnessModuleShape;
  try {
    mod = (await import(spec)) as HarnessModuleShape;
  } catch (error) {
    throw new HarnessLoadError(
      `Failed to import harness "${packageName}" (resolved to "${spec}"): ${(error as Error).message}`,
      { cause: error },
    );
  }
  const adapter = mod.default;
  if (
    adapter === undefined ||
    typeof adapter !== "object" ||
    adapter === null ||
    typeof (adapter as HarnessAdapter).id !== "string" ||
    typeof (adapter as HarnessAdapter).version !== "string" ||
    typeof (adapter as HarnessAdapter).runSession !== "function"
  ) {
    throw new HarnessLoadError(
      `Harness "${packageName}" does not export a default HarnessAdapter (need {id, version, runSession}). ` +
        `Wrap your adapter with \`defineHarness\` from \`@facet/sdk/harness\` and export it as the module's default.`,
    );
  }
  const result: LoadedHarness =
    typeof mod.register === "function"
      ? { adapter, register: mod.register }
      : { adapter };
  return result;
}
