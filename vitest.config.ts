import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

// Vitest reads source TypeScript directly (no need to wait for the
// per-package build), so the workspace's `@facet/*` imports are resolved
// here via aliases. Production runtime uses the `dist/` builds via
// `package.json#exports` instead.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: [
      // `.js` aliases first (more specific) — Vite picks the first match.
      {
        find: /^@facet\/sdk\/(.+)\.js$/,
        replacement: path.resolve(here, "packages/sdk/src/$1.ts"),
      },
      {
        find: /^@facet\/sdk\/(.+)$/,
        replacement: path.resolve(here, "packages/sdk/src/$1.ts"),
      },
      {
        find: /^@facet\/core\/(.+)\.js$/,
        replacement: path.resolve(here, "packages/core/src/$1.ts"),
      },
      {
        find: /^@facet\/core\/(.+)$/,
        replacement: path.resolve(here, "packages/core/src/$1.ts"),
      },
      {
        find: /^@facet\/harness-pi\/(.+)\.js$/,
        replacement: path.resolve(here, "packages/harness-pi/src/$1.ts"),
      },
      {
        find: /^@facet\/harness-pi\/(.+)$/,
        replacement: path.resolve(here, "packages/harness-pi/src/$1.ts"),
      },
      {
        find: /^@facet\/harness-pi$/,
        replacement: path.resolve(here, "packages/harness-pi/src/index.ts"),
      },
    ],
  },
});
