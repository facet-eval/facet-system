// Bullet 12.5 — dynamic trace-event schema composition.
//
// Pre-12.5 the on-disk shape of a trace.jsonl line was a closed
// `z.discriminatedUnion("type", [...])` baked into `src/tracer/schema.ts`.
// With trace-event kinds opening up this composer rebuilds that union
// at runtime from whatever the trace-event-registry exposes — six
// builtins from `src/builtins/trace-events/` plus any plugin-declared
// kind.

import { z } from "zod";

import type { TraceEventRegistry } from "./trace-event-registry.js";

// ts-prune-ignore-next
export class UnknownTraceEventKindError extends Error {
  constructor(eventType: unknown, registeredIds: readonly string[]) {
    super(
      `Unknown trace event kind ${JSON.stringify(eventType)} — registered kinds: ` +
        `[${registeredIds.join(", ")}]`,
    );
    this.name = "UnknownTraceEventKindError";
  }
}

// ts-prune-ignore-next
export function buildTraceEventSchema(
  registry: TraceEventRegistry,
): z.ZodTypeAny {
  const kinds = registry.list();
  if (kinds.length === 0) {
    throw new Error(
      "trace-event registry is empty; register at least one kind before composing the trace-event schema",
    );
  }
  if (kinds.length === 1) {
    return kinds[0]!.schema;
  }
  // discriminatedUnion needs each variant to be a ZodObject with a
  // matching literal discriminator on `type`. The builtins all satisfy
  // that; plugin authors should too. We accept ZodTypeAny here for the
  // signature but the runtime construction depends on the schemas being
  // discriminated on `type`.
  const variants = kinds.map((k) => k.schema) as unknown as readonly [
    z.ZodDiscriminatedUnionOption<"type">,
    z.ZodDiscriminatedUnionOption<"type">,
    ...z.ZodDiscriminatedUnionOption<"type">[],
  ];
  return z.discriminatedUnion("type", variants);
}

// Validates `event` against the registered kind for its `type`. Returns
// the event narrowed to the matching kind's payload, or throws
// `UnknownTraceEventKindError` if `type` is missing or unknown, or a
// `ZodError` from the matching schema's `.parse` if the payload fails
// validation. The Tracer uses this on every `record()` call when a
// registry is configured.
// ts-prune-ignore-next
export function validateTraceEvent(
  event: unknown,
  registry: TraceEventRegistry,
): unknown {
  const eventType =
    typeof event === "object" && event !== null && "type" in event
      ? (event as { type: unknown }).type
      : undefined;
  if (typeof eventType !== "string") {
    throw new UnknownTraceEventKindError(eventType, registry.ids());
  }
  const kind = registry.get(eventType);
  if (kind === undefined) {
    throw new UnknownTraceEventKindError(eventType, registry.ids());
  }
  return kind.schema.parse(event);
}
