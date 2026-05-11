// Shared registry primitive used by every kind-specific registry under
// `src/registries/`. Each typed registry (harness, factor-kind, trace-event,
// metric-kind, evaluator-layer, output-emitter, workspace-strategy,
// extensions-contribution) is a thin wrapper that pins the handler shape;
// the storage and dispatch logic lives here.
//
// Phase 13.1 will move this to `packages/core/src/registries/`. The
// public API is intentionally narrow — `register/get/has/list/ids` —
// so plugin authors and the spec composer have a single shape to reason
// about.

// ts-prune-ignore-next
export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

// ts-prune-ignore-next
export interface TypedRegistry<H extends { id: string }> {
  register(handler: H): void;
  get(id: string): H | undefined;
  list(): readonly H[];
  has(id: string): boolean;
  ids(): readonly string[];
}

// ts-prune-ignore-next
export function createTypedRegistry<H extends { id: string }>(
  registryName: string,
): TypedRegistry<H> {
  const map = new Map<string, H>();
  return {
    register(handler) {
      if (map.has(handler.id)) {
        throw new RegistryError(
          `Duplicate registration in ${registryName} registry: id "${handler.id}" already registered`,
        );
      }
      map.set(handler.id, handler);
    },
    get: (id) => map.get(id),
    list: () => Array.from(map.values()),
    has: (id) => map.has(id),
    ids: () => Array.from(map.keys()),
  };
}
