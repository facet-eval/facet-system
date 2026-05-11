import type { ExtensionsContribution } from "@facet/sdk/extensions-yaml";

import {
  createTypedRegistry,
  type TypedRegistry,
} from "./common.js";

// Each contribution claims a top-level key under `extensions.yaml`. The
// shared `id` slot in `TypedRegistry` aliases that key (we keep `id` for
// uniformity, even though the SDK type names the field `key`); the
// adapter below translates between them.
interface ExtensionsContributionEntry {
  readonly id: string;
  readonly contribution: ExtensionsContribution;
}

// ts-prune-ignore-next
export type ExtensionsContributionRegistry = TypedRegistry<ExtensionsContributionEntry>;

// ts-prune-ignore-next
export function createExtensionsContributionRegistry(): ExtensionsContributionRegistry {
  return createTypedRegistry<ExtensionsContributionEntry>("extensions-contribution");
}

// Convenience wrapper: takes a raw `ExtensionsContribution` (where the
// uniqueness slot is `key`) and registers it under `key` as the id.
// ts-prune-ignore-next
export function registerExtensionsContribution(
  registry: ExtensionsContributionRegistry,
  contribution: ExtensionsContribution,
): void {
  registry.register({ id: contribution.key, contribution });
}
