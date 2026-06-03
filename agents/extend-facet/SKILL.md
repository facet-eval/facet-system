---
name: extend-facet
description: >
  Extend, customize, or work with FACET internals by implementing an SDK seam
  and registering it — without editing @facet/core. Covers adding a new harness
  adapter, profile package, factor kind, metric kind, evaluator layer, output
  emitter, workspace strategy, trace event kind, or extensions-contribution.
  Use when the user says "add a new harness/profile/metric/factor to FACET",
  "support model/agent X", "customize FACET", "make a new preset", or "plug in
  a new output format / evaluator / workspace strategy".
---

# Extend FACET

Read [`AGENTS.md`](./AGENTS.md) in this folder first — it maps every SDK seam to
its `defineX()` helper, its spec/profile site, the core builtin to imitate, and
the loader/registry model. This skill is the procedure that uses that map.

Golden rule: **you implement an SDK interface and register it; you do not edit
`@facet/core`.** If you find yourself adding a concrete kind name to core, stop —
it belongs in an extension.

## Step 1 — Identify the seam

Restate the user's goal as exactly one (occasionally two) of the seams in the
AGENTS.md table. Quick triage:

- "support a new code agent / model runner" → **HarnessAdapter**.
- "a new profile = system prompt + tools + extensions" → **profile package**.
- "a new thing to vary across runs (a new matrix axis)" → **FactorKindHandler**.
- "a new number derived from the trace" → **MetricKindHandler**.
- "a new way to grade beyond the oracle script" → **EvaluatorLayerHandler**.
- "a new output/report format" → **OutputEmitterHandler**.
- "a new way to set up the per-run workspace" → **WorkspaceStrategyHandler**.
- "a new trace event to capture/translate" → **TraceEventKind**.
- "a new `extensions.yaml` block a profile can declare" → **ExtensionsContribution**.

If it's a profile package, jump to Step 5 (it's the common case and needs no
core/SDK code).

## Step 2 — Read the canonical shape

Open the seam's SDK file (`packages/sdk/src/<seam>.ts`) and the core builtin
that implements it (the "imitate" column in AGENTS.md), e.g.
`packages/core/src/builtins/output-emitters/results-table-csv.ts` for an emitter,
or `@facet/harness-pi` for a harness. Match their structure, naming, and
comment density. Do not invent a shape the SDK doesn't define.

## Step 3 — Implement with the `defineX()` helper

Wrap your implementation in the seam's helper so the authoring site is typed and
greppable:

| Seam | helper |
|---|---|
| HarnessAdapter | `defineHarness` |
| FactorKindHandler | `defineFactorKind` |
| MetricKindHandler | `defineMetricKind` |
| EvaluatorLayerHandler | `defineEvaluatorLayer` |
| OutputEmitterHandler | `defineOutputEmitter` |
| WorkspaceStrategyHandler | `defineWorkspaceStrategy` |
| TraceEventKind | `defineTraceEventKind` |
| ExtensionsContribution | `defineExtensionsContribution` |

Give it a unique, specific `id`. Validate config with a Zod `configSchema`/
`levelSchema` where the seam asks for one. For a **harness**, export the adapter
as `default` and implement `runSession` to translate the underlying SDK's native
events into FACET `TraceEvent`s, surfacing `tokenUsage`, `timedOut`, `costUsd`,
and `contextWindow` (see AGENTS.md "HarnessAdapter — the contract").

## Step 4 — Register it

Expose a `register(registries)` hook that registers your handler into the right
registry (mirror `@facet/harness-pi`'s `register()` and core's eager builtin
registration). Then wire the opt-in:

- **Harness** → the spec sets `metadata.harness.package` to your package; the
  loader imports it and calls `register` automatically.
- **Everything else** → the spec lists your package/module in
  `metadata.plugins: [ ... ]`; the loader imports each and calls `register`
  before composing schemas. (Local refs like `./plugins/my-emitter.js` resolve
  relative to the experiment package dir.)

Registries throw on duplicate `id` — keep ids unique.

## Step 5 — (Profile package path)

To ship a new profile, copy an existing preset as a template:

1. `cp -r packages/preset-pi-default packages/preset-pi-<name>` and edit
   `package.json` (`name`, `peerDependencies`, and the `facet` block:
   `profileRoot`, `harness`, `harnessVersionRange`).
2. Edit `profile/SYSTEM.md` (system prompt) and `profile/tools.yaml`
   (`tools: [...]` allowlist). Add `profile/extensions.yaml` for Pi extensions /
   `pinned_agents` / profile-declared `metrics`, and `profile/agents/<Name>.md`
   sub-agents if needed (imitate `preset-pi-subagents`).
3. **Recompute the hash:** `pnpm facet spec hash-profile packages/preset-pi-<name>`
   — this writes the canonical sha256 into `package.json#facet.hash`. Never
   hand-edit it.
4. Reference it from a spec's `extension_select` level with the **same** hash:
   `{ id: <name>, ref: "@facet/preset-pi-<name>", hash: "sha256:…" }`.

If a profile needs a brand-new `extensions.yaml` block kind, that block must be
backed by an `ExtensionsContribution` registered in the harness (Step 1–4 on the
ExtensionsContribution seam) — not a core edit.

## Step 6 — Build, validate, test (the acceptance criterion)

The CLI runs compiled `dist/`, so build first:

```bash
pnpm build
pnpm test                         # unit coverage for the new seam
pnpm lint:deadcode                # dead-export gate (annotate public exports // ts-prune-ignore-next)
pnpm facet spec validate <experiment-package-that-opts-your-extension-in>
```

For a profile, also confirm the hash round-trips (re-running `hash-profile`
leaves `package.json` unchanged) and that a spec referencing it validates. For a
harness/factor/metric/emitter, add or extend a test under `tests/framework/`
(synthetic fixtures — never reference an `examples/` package there) proving the
handler dispatches.

Report back: the seam, the new file(s), the `register`/opt-in wiring, and the
green `pnpm facet spec validate` + test output.

## Hard rules

- **No core edits for concrete kinds.** New kinds register through the SDK path.
  If core seems to need the change, you've mis-identified the seam — re-read
  AGENTS.md.
- **`@facet/sdk` stays runtime-dep-free.** Interfaces + `defineX` only.
- **Strict TS**, no implicit `any`, justify any `@ts-ignore`, annotate public
  exports for the dead-code gate.
- **Recompute, never hand-write, profile hashes.** A stale hash fails validation.
- **Stop on SDK gaps** — don't parse stdout or fake APIs to work around a
  missing seam capability. Surface it and ask.
- Follow repo conventions for any commit (feature branch, conventional + gitmoji,
  squash, **no AI attribution**, English) — but don't commit unless asked.
