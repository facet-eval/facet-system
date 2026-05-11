// Pi-specific version probe. Lives under @facet/harness-pi (Phase 13.1)
// so the core has no `@mariozechner` literal in its source. The function
// walks up from this module to find an installed
// `@mariozechner/pi-coding-agent/package.json` and reads its `version`.
// Phase 13.2 will eliminate the need for this entirely — the validator
// and manifest will read `adapter.version` from the registered
// HarnessAdapter, not from a node_modules walk.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ts-prune-ignore-next
export function getInstalledPiVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  while (true) {
    const candidate = path.join(
      dir,
      "node_modules",
      "@mariozechner",
      "pi-coding-agent",
      "package.json",
    );
    try {
      const raw = readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
      break;
    } catch {
      // not here, walk up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "unknown";
}
