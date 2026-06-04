# `@facet/sdk`

- [Why it exists](#why-it-exists)
- [The eight seams](#the-eight-seams)
- [The profile-package manifest](#the-profile-package-manifest)
- [`defineX()` and zero dependencies](#definex-and-zero-dependencies)
- [How core and harnesses consume it](#how-core-and-harnesses-consume-it)

## Why it exists

`@facet/sdk` is the public contract everyone imports to extend FACET. It holds
pure interfaces and `defineX()` identity helpers, with zero runtime
dependencies (only `zod` as a peer). A contributor adding a harness, factor, or
metric depends on this package alone — never on the runtime. This split is what
makes the framework a [layer](../evaluation-layer.md) rather than an app.

## The eight seams

Each seam is one entry point: an interface plus a `defineX()` helper. FACET's own
builtins register through the same helpers a third party would.

| Seam | Responsibility |
|---|---|
| `HarnessAdapter` | Wraps a concrete agent. Exposes `{ id, version, runSession }`; translates the agent's events into SDK `TraceEvent`s; may provide `register(registries)` to add harness-specific metric kinds and extensions contributions. |
| `FactorKindHandler` | Defines a kind of varying factor. Provides `expand(factor)` to enumerate levels and `apply(value, draft)` to materialize them into a `RunConfig`. |
| `MetricKindHandler` | Defines a metric reduced over the trace. Reads the `TraceEvent` stream, emits one value per run. |
| `EvaluatorLayerHandler` | Defines a post-run evaluation layer. The builtin `oracle_script` runs `scenarios/<id>/oracle/run.sh` and parses `[task_id] PASS/FAIL` markers. The interface anticipates LLM-as-judge, mutation testing, security scans. |
| `OutputEmitterHandler` | Defines how aggregated results serialize. Builtins: `results_table_csv`, `results_table_jsonl`. A plugin could add Parquet, SQLite, dashboards. |
| `WorkspaceStrategyHandler` | Defines how a workspace is isolated per run. Builtin: `git_worktree`. A plugin could add Docker, FUSE, ephemeral VMs. |
| `TraceEventKind` | Defines a trace event type. The six builtins cover the agent lifecycle; a harness may add its own. |
| `ExtensionsContribution` | Lets a harness add typed sub-blocks to a profile's `extensions.yaml` (e.g. Pi's `pinned_agents`, `language_servers`), each with its own Zod schema and `preflight()`. The core never knows the names. |

Source: `packages/sdk/src/{harness,factor-kind,metric-kind,evaluator-layer,output-emitter,workspace-strategy,trace-event,extensions-yaml}.ts`.

## The profile-package manifest

A ninth, cross-cutting contract. `ProfilePackageManifestSchema` defines the
`package.json#facet` block of a distributable profile package:

```jsonc
"facet": {
  "profileRoot": "./profile",
  "harness": "@facet/harness-pi",
  "harnessVersionRange": "^0.70",
  "hash": "sha256:…"
}
```

See [Profile presets](presets.md) for how this is produced and verified.

## `defineX()` and zero dependencies

Two choices keep the entry barrier low.

Zero runtime deps: every library a plugin must import adds weight to every
consumer, so the SDK stays minimal (only `zod` as a peer).

`defineX()` helpers over inheritance or decorators: an author writes a function
that returns a plain object, and the helper stamps the identity (`id`, `version`,
schema) the core needs to register and dispatch it. Immutability and type
inference are preserved.

```mermaid
flowchart LR
  author["author writes<br/>plain object"] --> helper["defineX()<br/>stamps identity"]
  helper --> registry["core registry<br/>dispatch by id"]
```

## How core and harnesses consume it

Both sit in [ring 2](../architecture.md#three-rings) and import the SDK as
equals. The core registers its builtins through `defineX()`; `@facet/harness-pi`
implements `HarnessAdapter` and registers its own metric kinds. Neither has a
privileged path. To build your own, see [Extending FACET](../guides/extending.md).
