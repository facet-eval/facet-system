import { Type } from "typebox";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "__discovered_sentinel__",
    label: "Sentinel",
    description:
      "Auto-discovery sentinel: must NOT be loaded when noExtensions:true.",
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: "sentinel" }],
      details: {},
    }),
  });
}
