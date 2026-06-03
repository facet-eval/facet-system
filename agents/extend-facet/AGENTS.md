# AGENTS.md — extend-facet (domain reference)

Reference for **extending, customizing, and working with FACET internals**. The
procedure lives in [`SKILL.md`](./SKILL.md); this file is the map of seams, the
registry/loader model, and the conventions. Read it before adding anything.

## The mental model

FACET's runtime (`@facet/core`) knows only **dispatch shapes**, never concrete
kinds. Every concrete capability — a harness, a factor kind, a metric kind, an
evaluator layer, an output emitter, a workspace strategy, a trace event kind, a
profile — is registered into a registry at startup and dispatched by `id`. Even
the "builtins" core ships (the four factor kinds, six trace events, the oracle
evaluator, two emitters, the git-worktree strategy) register through the **same
public path** a third party uses. There is no privileged internal door.

Consequence: **to extend FACET you implement an SDK interface, wrap it in its
`defineX()` helper, and register it** — you do not edit `@facet/core`.

## How extensions get loaded (the opt-in path)

At CLI startup the loader, in order:

1. dynamically imports `spec.metadata.harness.package` (e.g.
   `@facet/harness-pi`) and calls its optional `register(registries)` hook;
2. dynamically imports each `spec.metadata.plugins[]` ref and calls its
   `register(registries)` hook;
3. only then composes the active Zod schemas from the now-populated registries
   and parses the spec.

So a spec opts into your extension one of two ways:

- it's a **harness** → set `metadata.harness.package` to your package;
- it's anything else (factor kind, metric kind, evaluator layer, output emitter,
  workspace strategy, trace event kind) → add your package/module to
  `metadata.plugins: [...]`. Refs resolve like profile refs: scoped/bare names
  hit npm; `./x`, `../x`, `/abs`, `~/abs` resolve relative to the experiment
  package dir.

A `register(registries)` hook receives the registry set and registers its
handlers; registries throw on duplicate `id`, so make ids unique and specific.
Mirror `@facet/harness-pi`'s `register()` (it registers its three metric kinds
and its extensions-contributions) and core's eager builtin registration in
`packages/core/src/registries/` + `packages/core/src/builtins/`.

## The SDK seams

Every seam is a file under `packages/sdk/src/` exposing an interface + a
`defineX()` identity helper (the helper just returns its argument — it exists so
authoring sites are greppable and type-inferred). Pick the seam that matches
what you're adding:

| Seam (SDK file) | `defineX()` | Add one when you want to… | Spec/profile site | Core builtin to imitate |
|---|---|---|---|---|
| `HarnessAdapter` (`harness.ts`) | `defineHarness` | support a **new code agent** (e.g. Aider, OpenHands) | `metadata.harness.package` | `@facet/harness-pi` |
| `FactorKindHandler` (`factor-kind.ts`) | `defineFactorKind` | add a **new varying-factor `type`** (a new matrix axis, e.g. `tokenizer_swap`) | `varying_factors[].type` | `builtins/factor-kinds/*` |
| `MetricKindHandler` (`metric-kind.ts`) | `defineMetricKind` | derive a **new layer-2 metric** from the trace | `extensions.yaml metrics[].kind` (profile) | `harness-pi/src/metric-kinds/*` |
| `EvaluatorLayerHandler` (`evaluator-layer.ts`) | `defineEvaluatorLayer` | add a **new grading layer `type`** beyond `oracle_script` | `metrics.evaluator.layers[].type` | `builtins/evaluator-layers/oracle-script.ts` |
| `OutputEmitterHandler` (`output-emitter.ts`) | `defineOutputEmitter` | add a **new `analysis.emit` output format** | `analysis.emit[]` | `builtins/output-emitters/*` |
| `WorkspaceStrategyHandler` (`workspace-strategy.ts`) | `defineWorkspaceStrategy` | add a **new way to materialize the per-run workspace** | `environment.workspace_strategy` | `builtins/workspace-strategies/git-worktree.ts` |
| `TraceEventKind` (`trace-event.ts`) | `defineTraceEventKind` | emit/translate a **new trace event type** | adapter boundary | `builtins/trace-events/*` |
| `ExtensionsContribution` (`extensions-yaml.ts`) | `defineExtensionsContribution` | let a **profile declare a new `extensions.yaml` block** an adapter consumes (e.g. `pinned_agents`) | `extensions.yaml.<key>` | `harness-pi` ExtensionsContributions |
| `ProfilePackageManifest` (`profile-package.ts`) | — | ship a **new distributable profile** (tools/system-prompt/extensions tuple) | `extension_select` level `ref` | `packages/preset-pi-*` |

### HarnessAdapter — the contract (most involved)

```ts
interface HarnessAdapter {
  readonly id: string;        // matches spec.metadata.harness.id; lands in trace _meta + manifest
  readonly version: string;   // resolved underlying-SDK version; validator cross-checks spec.metadata.harness.version
  runSession(
    config: HarnessRunConfig,
    userPrompt: string,
    cwd: string,
    onEvent?: (event: TraceEvent) => void,
  ): Promise<HarnessRunResult>;
}
```

The adapter's whole job is to drive the underlying agent SDK and **translate its
native events into FACET `TraceEvent`s at the boundary** — the runner never sees
native event types. `HarnessRunConfig` carries `provider`, `modelId`, `apiKey`
(runner reads `${PROVIDER}_API_KEY`), `tools`, `systemPrompt`, `timeoutMs`,
`harnessParams`, an open `extras` bag (profile contributions the adapter
understands, e.g. Pi's `agentDir`/`appendSystemPrompts`), and `packageRoot`.
`HarnessRunResult` must report `events`, `tokenUsage`, `durationMs`, `timedOut`,
`costUsd`, `clarificationRequestsCount`, and `contextWindow` (0 = unknown,
disables context-utilization metrics). Export the adapter as **default** (the
loader does `await import(pkg)` then reads `.default`) and provide an optional
`register(registries)` to add harness-specific metric kinds / extensions
contributions. Translate timeouts into `timedOut: true`; do not throw on budget
exhaustion.

### MetricKindHandler — the fold contract

A metric kind folds the trace into one number via
`initialState(config)` → `evaluate(event, state, config)` per consumed event →
`finalize(state, config): number`. Declare `consumes: readonly string[]` (the
trace event `type`s you read) — the accumulator only dispatches those, which is
the performance contract. `configSchema` (a Zod type) validates the per-rule
fields beyond `id`/`kind` in an `extensions.yaml metrics[]` entry. The result
lands in `metrics.json.profile_metrics[rule.id]` and the aggregated CSV.

### FactorKindHandler — the axis contract

A factor kind declares `levelSchema` (one matrix-axis value), `expand` (enumerate
axis values from a declared factor), and `apply` (fold one axis value into the
mutable `RunConfigDraft` the runner freezes into a `RunConfig`). The draft is
open by design — a new kind may write new keys (e.g. `tokenizerId`) and the
runner threads them into the trace + manifest. The four classic kinds
(`prompt_swap`, `extension_select`, `model_swap`, `model_param`) are registered
builtins; a fifth is a deliberate, registered addition — no schema edit in core.

## Profile packages (the most common extension)

A profile package is a plain npm package:

```
packages/preset-pi-<name>/
├── package.json          # name + "facet": { profileRoot, harness, harnessVersionRange, hash } + peerDependencies
└── profile/
    ├── SYSTEM.md         # the system prompt
    ├── tools.yaml        # tools: [ ... ]  (the tool allowlist)
    ├── extensions.yaml   # OPTIONAL: extensions[], pinned_agents, profile-declared metrics[]
    └── agents/           # OPTIONAL: <Name>.md sub-agent definitions, ${RUN_MODEL} substituted per run
```

`package.json#facet`:

```json
{
  "facet": {
    "profileRoot": "./profile",
    "harness": "@facet/harness-pi",
    "harnessVersionRange": "^0.70",
    "hash": "sha256:<recompute with facet spec hash-profile>"
  },
  "peerDependencies": { "@facet/harness-pi": "workspace:*" }
}
```

The `hash` is the canonical sha256 of `profileRoot`. **Never hand-edit it** —
run `pnpm facet spec hash-profile packages/preset-pi-<name>`, which recomputes
and writes it back. Any spec `extension_select` level that references the
profile must carry the **same** hash, or validation fails (this is the
reproducibility guarantee). `extensions.yaml` blocks (e.g. `pinned_agents`,
profile `metrics`) are each backed by an `ExtensionsContribution` the harness
registered — adding a brand-new block kind means registering a new contribution
in the harness, not editing core.

## Conventions for extension code

- **`@facet/sdk` stays dependency-free.** It declares interfaces + `defineX`
  helpers only (`zod` is a peer). Never add a runtime dep to the SDK.
- **Strict TypeScript**, no implicit `any`, no `@ts-ignore` without a
  justifying comment. Mark intentional public exports with
  `// ts-prune-ignore-next`; `pnpm lint:deadcode` is a gate.
- **Imitate, don't invent.** For any seam, read its SDK file and the matching
  `packages/core/src/builtins/**` (or `@facet/harness-pi`) builtin before
  writing. They are the canonical shape.
- **One id, registered once.** Registries throw on duplicate ids. Choose
  specific, namespaced ids.
- **`pnpm build` before the CLI sees your change** — the CLI runs compiled
  `dist/`. Then `pnpm facet spec validate` an experiment that opts your
  extension in, and `pnpm test`.
- **Stop on SDK gaps.** If a seam doesn't expose what you need (e.g. the harness
  SDK lacks an event you want to translate), do not parse stdout or fake an API.
  Surface the gap and ask.
