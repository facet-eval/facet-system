import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";

import type { TraceEventRegistry } from "../registries/trace-event-registry.js";
import { validateTraceEvent } from "../registries/trace-event-schemas.js";

import {
  TRACE_VERSION,
  type TraceEvent,
  type TraceMetaLine,
} from "./schema.js";

export class TracerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TracerError";
  }
}

export interface TracerOptions {
  readonly outputPath: string;
  // Stable id for the harness that produced the events (e.g. `"pi"`). The
  // tracer writes this as the first `_meta` line so downstream readers can
  // refuse to consume traces produced by an incompatible harness.
  readonly harness: string;
  // Pinned version of the harness package (e.g. pi-coding-agent's
  // package.json `version`). Surfaces in `_meta.harness_version`.
  readonly harnessVersion: string;
  // Bullet 12.5 — when present, every `record()` call validates the event
  // against the schema of its registered kind before persisting.
  // Unregistered `event.type`s raise `UnknownTraceEventKindError`; payload
  // validation failures raise `ZodError`. Production today leaves this
  // undefined (closed-union back-compat); Phase 12.7 / 13.2 wires the
  // registry through from the CLI/harness loader.
  readonly traceEventRegistry?: TraceEventRegistry;
}

export class Tracer {
  public readonly outputPath: string;
  public readonly harness: string;
  public readonly harnessVersion: string;
  private readonly traceEventRegistry?: TraceEventRegistry;
  private fd: number;
  private closed = false;

  constructor(options: TracerOptions) {
    this.outputPath = path.resolve(options.outputPath);
    this.harness = options.harness;
    this.harnessVersion = options.harnessVersion;
    if (options.traceEventRegistry !== undefined) {
      this.traceEventRegistry = options.traceEventRegistry;
    }
    mkdirSync(path.dirname(this.outputPath), { recursive: true });
    try {
      this.fd = openSync(this.outputPath, "a");
    } catch (error) {
      throw new TracerError(
        `Failed to open trace file at ${this.outputPath}: ${(error as Error).message}`,
        { cause: error },
      );
    }
    // Write the `_meta` line eagerly so consumers can rely on it being
    // present whenever a trace.jsonl exists at all. A retried run that
    // re-opens the same file in append mode lands a second meta line; that
    // is acceptable — readers ignore meta lines after the first one and
    // the runner deletes the run dir on retry today.
    const meta: TraceMetaLine = {
      _meta: {
        trace_version: TRACE_VERSION,
        harness: this.harness,
        harness_version: this.harnessVersion,
      },
    };
    writeSync(this.fd, JSON.stringify(meta) + "\n");
  }

  record(event: TraceEvent): void {
    if (this.closed) {
      throw new TracerError(`Tracer already closed: ${this.outputPath}`);
    }
    if (this.traceEventRegistry !== undefined) {
      // Throws UnknownTraceEventKindError or ZodError on bad events; the
      // tracer surfaces those to the caller (the Pi adapter / runner)
      // instead of swallowing them with a `__tracer_error__` line.
      validateTraceEvent(event, this.traceEventRegistry);
    }
    let line: string;
    try {
      line = JSON.stringify(event);
    } catch (error) {
      line = JSON.stringify({
        type: "__tracer_error__",
        reason: "unserializable_event",
        error: (error as Error).message,
      });
    }
    writeSync(this.fd, line + "\n");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.fd);
  }
}
