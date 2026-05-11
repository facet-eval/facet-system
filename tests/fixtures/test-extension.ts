import { Type } from "typebox";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "noop_tool",
    label: "Noop",
    description: "A no-op tool used by the bullet 01 wiring tests.",
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: "noop" }],
      details: {},
    }),
  });
}
