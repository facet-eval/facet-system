// Bullet 15.2 — plugin loader.
//
// `loadPlugins(refs, contextDir, registries)` dynamically imports each
// ref and calls its `register(registries)` hook (or `default.register`).
// Refs follow the same classification rule as profile refs:
//   - starts with `@` (scoped) or is a bare unscoped name (no `/`,
//     no `.`) ⇒ npm package, resolved via the upward `node_modules`
//     walk from `contextDir`;
//   - everything else (`./foo`, `../foo`, `/abs`, `~/abs`, `foo/bar`)
//     ⇒ relative path, resolved against `contextDir`.
//
// A plugin that exports a synchronous `register` is supported; one
// that returns a Promise is awaited. A plugin without a `register`
// export is a hard failure — the CLI cannot guess what to wire.

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ts-prune-ignore-next
export class PluginLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PluginLoadError";
  }
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

function resolveLocalPlugin(ref: string, contextDir: string): string {
  const absolute = path.resolve(contextDir, ref);
  if (existsSync(absolute)) return absolute;
  for (const ext of [".ts", ".js", ".mjs", "/index.ts", "/index.js", "/index.mjs"]) {
    const candidate = `${absolute}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  throw new PluginLoadError(
    `Plugin "${ref}" resolved to "${absolute}" but the file does not exist.`,
  );
}

// ts-prune-ignore-next
export interface PluginModule {
  readonly register?: (registries: unknown) => void | Promise<void>;
  readonly default?: {
    readonly register?: (registries: unknown) => void | Promise<void>;
  };
}

// ts-prune-ignore-next
export async function loadPlugins(
  refs: readonly string[],
  contextDir: string,
  registries: unknown,
): Promise<void> {
  for (const ref of refs) {
    let spec: string;
    if (isNpmRef(ref)) {
      spec = ref;
    } else {
      const local = resolveLocalPlugin(ref, contextDir);
      spec = pathToFileURL(local).toString();
    }
    let mod: PluginModule;
    try {
      mod = (await import(spec)) as PluginModule;
    } catch (error) {
      throw new PluginLoadError(
        `Failed to import plugin "${ref}" (resolved to "${spec}"): ${(error as Error).message}`,
        { cause: error },
      );
    }
    const register = mod.register ?? mod.default?.register;
    if (typeof register !== "function") {
      throw new PluginLoadError(
        `Plugin "${ref}" does not export a \`register(registries)\` function (neither as a named export nor on the default export).`,
      );
    }
    try {
      await register(registries);
    } catch (error) {
      throw new PluginLoadError(
        `Plugin "${ref}" \`register(registries)\` threw: ${(error as Error).message}`,
        { cause: error },
      );
    }
  }
}
