// Bullet 16.2 — Pi-specific `language_servers` sub-block of
// `extensions.yaml`. The map binds a scenario id to the language-server
// binary the Pi-LSP extension should launch for that scenario. Moved
// out of core because (a) the concept is tied to @dreki-gg/pi-lsp, not
// universal to any code agent, and (b) the binary-on-PATH preflight
// the validator runs against these entries is already captured under
// the universal `requires_binaries_per_scenario` flow, so no
// contribution-side preflight is needed here.

import { z } from "zod";

import { defineExtensionsContribution } from "@facet/sdk/extensions-yaml";

// Record<scenarioId, binaryName>. Both sides are non-empty strings; the
// validator preflight that walks the resolved binaries lives in core's
// existing requires-binaries machinery (it pulls the binary names off
// the parsed manifest unchanged from the pre-16.2 behavior).
export const LanguageServersValueSchema = z.record(
  z.string().min(1),
  z.string().min(1),
);

export type LanguageServersValue = z.infer<typeof LanguageServersValueSchema>;

export const languageServersContribution = defineExtensionsContribution<LanguageServersValue>({
  key: "language_servers",
  schema: LanguageServersValueSchema,
});
