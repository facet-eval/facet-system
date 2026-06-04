# Glossary

Precise definitions of the terms used across this documentation.

| Term | Definition |
|---|---|
| **Run** | One execution of the harness over an isolated workspace, with a fixed model, profile, prompt, and scenario. The unit of work. Continues until the agent ends its session or the timeout fires. |
| **Factor** | One independent variable of an experiment (model, profile, prompt, a harness param). Listed under `varying_factors` when it varies. |
| **Level** | One value a factor can take. The matrix is the Cartesian product of all factors' levels. |
| **Factor kind** | The category of a factor, which decides how its levels materialize into a `RunConfig`. Builtins: `prompt_swap`, `extension_select`, `model_swap`, `model_param`. See [SDK](../packages/sdk.md). |
| **Scenario** | A coding task packaged as a directory: `meta.yaml`, a `repo/` snapshot, prompt files, and an `oracle/`. |
| **Oracle** | The script (`oracle/run.sh`) that scores a finished workspace, emitting `[task_id] PASS/FAIL` markers. Backs the `oracle_script` evaluator layer. |
| **Profile** | An agent configuration: system prompt, tool allowlist, optional extensions and sub-agents. Distributed as a [profile package](../packages/presets.md). |
| **Preset** | A distributable profile package, `@facet/preset-pi-*`. |
| **Harness** | The adapter that drives a concrete agent and translates its events into `TraceEvent`s. The reference is [`@facet/harness-pi`](../packages/harness-pi.md). |
| **Seam** | One of the eight public extension contracts in the [SDK](../packages/sdk.md). A typed socket for builtins and plugins alike. |
| **Trace** | The ordered stream of `TraceEvent`s a run emits, persisted as `trace.jsonl`. |
| **TraceEvent** | The generic, agent-agnostic event the SDK defines. Harness-native events are translated into this shape at the adapter edge. |
| **Metric (Layer 2)** | A value derived by reducing over the trace (e.g. `tool_call_count`), as opposed to oracle pass/fail. |
| **Experiment Package** | The input directory: `spec.yaml`, `scenarios/`, and resolved `node_modules/`. What `facet run` consumes. |
| **Experiment Spec** | The declarative `spec.yaml` that defines one experiment. See [Experiment spec](experiment-spec.md). |
| **Result Bundle** | The self-contained `result-*/` output: inputs, per-run artifacts, aggregated tables, manifest. See [Result Bundle](result-bundle.md). |
| **Manifest** | `manifest.yaml` in a bundle: versions, SHA-256 input hashes, and run status. The reproducibility record. |
| **Registry** | A core map per contract; builtins and plugins register handlers, and the runner dispatches by `id`. See [core](../packages/core.md). |
| **Workspace strategy** | How a run's workspace is isolated. Builtin: `git_worktree`. |
| **Budget tracker** | The runtime guard that stops new runs once `max_total_cost_usd` is exceeded. |
| **Repetition** | A re-run of an identical matrix cell, used to model stochastic variance (`design.repetitions`). |
