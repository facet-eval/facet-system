import type { WorkspaceStrategyHandler } from "@facet/sdk/workspace-strategy";

import {
  createTypedRegistry,
  type TypedRegistry,
} from "./common.js";

// ts-prune-ignore-next
export type WorkspaceStrategyRegistry = TypedRegistry<WorkspaceStrategyHandler>;

// ts-prune-ignore-next
export function createWorkspaceStrategyRegistry(): WorkspaceStrategyRegistry {
  return createTypedRegistry<WorkspaceStrategyHandler>("workspace-strategy");
}
