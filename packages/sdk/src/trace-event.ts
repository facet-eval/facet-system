// @facet/sdk — trace-event.ts
//
// Public contract for trace events. The on-disk shape of `trace.jsonl` is
// composed at runtime by the trace-event-registry from the kinds registered
// by the active harness plus core builtins. Plugin authors declare a kind
// with `defineTraceEventKind` and the validator runs it before the tracer
// persists the event.
//
// The base shape every kind must satisfy is `TraceEventBase`. Concrete kinds
// extend it with whatever payload they carry. Consumers narrow by `type`.

import type { ZodType } from "zod";

// ts-prune-ignore-next
export interface TraceEventBase {
  readonly type: string;
  // ISO-8601 wall-clock timestamp stamped at translation time. Readers may
  // use it for ordering when the file is replayed out of order, but the
  // JSONL line order remains authoritative for in-process derivations.
  readonly timestamp: string;
}

// Public alias for FACET-shaped trace events at the SDK boundary. Concrete
// kinds (declared via `defineTraceEventKind` and registered in Phase 12.5)
// extend `TraceEventBase` with their own payload fields. Consumers narrow
// with `event.type === "my_kind"` to recover the concrete kind they
// declared. Pre-Phase-12.5 the core's closed `TraceEvent` union from
// `src/tracer/schema.ts` is structurally compatible because every member
// extends this shape; Phase 12.5 swaps the closed union for a
// registry-built one without touching this declaration.
// ts-prune-ignore-next
export type TraceEvent = TraceEventBase;

// ts-prune-ignore-next
export interface TraceEventKind<TPayload extends TraceEventBase = TraceEventBase> {
  // Discriminator value, e.g. "turn_start" or "gpu_telemetry". Must be
  // unique within the active registry; duplicate registration is an error.
  readonly id: string;
  // Zod schema validating the full event shape (including `type` literal
  // and `timestamp`). The tracer parses each emitted event against this
  // schema before persisting; unparseable events surface as
  // `TraceEventValidationError` in the harness adapter.
  readonly schema: ZodType<TPayload>;
}

// ts-prune-ignore-next
export function defineTraceEventKind<TPayload extends TraceEventBase>(
  kind: TraceEventKind<TPayload>,
): TraceEventKind<TPayload> {
  return kind;
}
