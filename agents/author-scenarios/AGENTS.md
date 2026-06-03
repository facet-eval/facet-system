# AGENTS.md — author-scenarios (domain reference)

Reference material for **building FACET experiments and grading tests from a
repository's history**. The step-by-step procedure lives in [`SKILL.md`](./SKILL.md);
this file is the anatomy, the contracts, and the one invariant you must never
break. Read it before authoring.

## The core idea

A real change in version control already contains everything a code-agent task
needs:

- the **start state** = the repository *before* the change (the parent commit);
- the **goal state** = the repository *after* the change (the change commit);
- the **grader** = the unit/integration tests that the change added or modified
  to prove it works.

So authoring a scenario is mostly **extraction**: pick a bug fix / feature /
refactor commit (or PR), lay its parent tree into `repo/`, its own tree into
`reference_solution/`, and its tests into `oracle/`. Then write prompts at
varying specificity, a `meta.yaml`, and a `spec.yaml` matrix around it.

## THE INVARIANT (differential oracle)

> **The oracle must FAIL when run against `repo/` (start state) and PASS when run
> against `reference_solution/` (goal state).**

This is the single property that makes a scenario meaningful. If the oracle
passes on the untouched start state, the task is already solved and measures
nothing. If it fails on the reference solution, the grader is wrong. **Always
verify both ends before you consider a scenario done** (SKILL.md step 9). This
is non-negotiable — it is the acceptance criterion for the whole skill.

## Scenario directory anatomy

Mirror an existing scenario such as
`examples/default-qwen-python/scenarios/compound-python/`:

```
scenarios/<scenario-id>/
├── meta.yaml                 # scenario manifest (parsed by validator + runner)
├── repo/                     # START STATE — becomes the per-run git repo the agent edits
│   └── …                     #   (override the dir name via meta.code_dir; default "repo")
├── reference_solution/       # GOAL STATE — the human/ground-truth solution (not shown to the agent)
│   └── …
├── prompts/                  # one file per specificity level
│   ├── underspecified.md
│   ├── medium.md
│   └── specific.md
└── oracle/
    ├── run.sh                # entry point; $1 = workspace path; exit 0 iff task tests pass
    ├── tests/                # the graded tests (the ones the change introduced or inferred)
    │   └── …
    └── regression_tests/     # OPTIONAL advisory tests (do not affect exit code)
        └── …
```

`repo/` and `reference_solution/` hold the *same subtree of files* in two states.
Keep them scoped to the package/module the change touches — you do not need the
whole monorepo, only what the task spans and what the tests import.

## The oracle contract

`oracle/run.sh` is the grader. Study `examples/.../oracle/run.sh` and preserve
its contract exactly:

- **Args:** `$1` = absolute path to the agent's workspace (its edited copy of
  `repo/`). The script resolves its own dir via `BASH_SOURCE` to find `tests/`.
- **Output:** prints one `[<task_id>] PASS|FAIL` line per graded task, and
  `[<reg_id>] PASS|FAIL` for advisory regression tests.
- **Exit code (binary contract):** `exit 0` **iff every graded task test passes**;
  otherwise `exit 1`. Use `exit 2` for harness errors (missing workspace,
  missing interpreter). Regression tests are descriptive only and **must not**
  change the exit code.
- The `task_id`s the oracle emits must match `meta.task_ids` (default
  `["task1","task2","task3"]`). A single-task scenario declares
  `task_ids: ["task1"]` and the oracle emits exactly that line.
- Make tests workspace-relative: the start state may be importable but broken;
  the tests run against `$WS`, e.g. `PYTHONPATH="$WS" python3 tests/test_x.py`.

The spec wires the oracle in via the `correctness` evaluator layer
(`type: oracle_script`, `script: "oracle/run.sh"`, `pass_condition: "exit_code == 0"`).

## meta.yaml fields

```yaml
id: <scenario-id>            # must equal the directory name and spec scenarios[].id
language: python             # informational
task_type: compound          # bug | feature | refactor | compound (informational tag)
difficulty: medium            # informational
tags: [bug, invisible-tests, from-history]
prompts:                      # REQUIRED — one entry per prompt file under prompts/
  - id: underspecified
    file: prompts/underspecified.md
  - id: medium
    file: prompts/medium.md
  - id: specific
    file: prompts/specific.md
requires_binaries: ["python3"]   # optional; validator preflights these are on PATH
task_ids: ["task1", "task2"]      # optional; defaults to ["task1","task2","task3"]; order = CSV column order
code_dir: "repo"                  # optional; subdir that becomes the per-run repo (default "repo")
bundle_excludes: ["coverage"]     # optional; extra basenames excluded from the captured workspace
```

`meta.yaml` is parsed `.passthrough()` at the root (extra keys tolerated) but
strict on the well-known inner shapes — a typo like `flie:` in a prompt entry
will error.

## Prompt specificity levels

Three levels, by convention, because prompt specificity is itself a common
varying factor (`prompt_swap`):

- **underspecified** — names the symptom only ("there's a routing bug, find and
  fix it"). No file paths, no API shapes.
- **medium** — names the tasks, the files, and the contract, but not the code.
- **specific** — gives the near-exact diff intent: signatures, the offending
  line, expected output format. Essentially executable instructions.

All three must be solvable to the **same** oracle. They differ only in how much
the agent must infer. Do not leak the reference solution wholesale into
`specific.md` — give intent and contracts, not a copy-paste patch, unless the
study explicitly wants the trivial upper bound.

Only mention subagents/tools in a prompt when the selected profile exposes them
(see the profile catalog below) — otherwise the instruction is dead text.

## spec.yaml field reference

The matrix. Top-level keys are strict (`ExperimentSpecSchema`). Skeleton:

```yaml
metadata:
  id: <experiment-id>
  name: "..."
  description: >
    ...
  version: "0.1.0"
  author: "..."
  seed: 42
  framework_version: "0.1.0"
  harness:                     # the ONLY harness selector (pi_version was removed)
    id: "pi"
    package: "@facet/harness-pi"
    version: "0.70.0"          # cross-checked against the loaded adapter's reported version
  # plugins: ["./my-plugin"]   # optional: extra register(registries) modules

environment:
  timeout_per_run_seconds: 900
  max_tokens_per_run: 200000
  max_total_cost_usd: 1.0
  workspace_strategy: "git_worktree"

varying_factors:               # at least one; each axis multiplies the matrix
  - id: prompt_id              # type inferred as prompt_swap for legacy id "prompt_id"
    description: "Prompt specificity."
    levels:
      - id: underspecified
      - id: medium
      - id: specific
  - id: profile                # type inferred as extension_select for legacy id "profile"
    description: "Agent profile."
    levels:
      - id: default
        ref: "@facet/preset-pi-default"
        hash: "sha256:…"       # MUST match the preset's package.json#facet.hash
  - id: model                  # type inferred as model_swap for legacy id "model"
    description: "Model under test."
    levels:
      - id: qwen3.5-9b
        provider: openrouter
        model_id: "qwen/qwen3.5-9b"

scenarios:
  - id: <scenario-id>
    ref: "scenarios/<scenario-id>"
    hash: "TBD"                # no hash-scenario CLI yet; "TBD" satisfies the schema

design:
  type: full_factorial
  repetitions: 1
  parallelism: 4

comparisons:                   # the questions the matrix answers (may be empty [])
  - id: prompt_specificity
    description: "How does prompt specificity affect correctness?"
    across: prompt_id
    holding_constant: [profile, model]

metrics:
  trace:
    capture: [tool_calls, tokens_in, tokens_out, latency_ms_per_turn, file_reads, context_size_per_turn]
  evaluator:
    layers:
      - id: correctness
        type: oracle_script
        script: "oracle/run.sh"
        pass_condition: "exit_code == 0"
  judge: null

analysis:
  type: none
  emit: [results_table_csv]    # and/or results_table_jsonl
```

**Factor kinds** (the `type` discriminator; the three classic ids auto-infer):

| `type` | classic `id` | level shape |
|---|---|---|
| `prompt_swap` | `prompt_id` | `{ id }` (matches a `prompts[].id` in the scenario) |
| `extension_select` | `profile` | `{ id, ref, hash }` (+ optional `metadata`) |
| `model_swap` | `model` | `{ id, provider, model_id }` |
| `model_param` | — | `{ id, value }` + factor-level `param: "<name>"` (note: no current harness applies these; they are threaded through for traceability) |

**Matrix size** = product of all `varying_factors` level counts × `scenarios` ×
`design.repetitions`. Keep it small while iterating; cost is bounded by
`max_total_cost_usd`.

## Profile catalog (extension_select levels)

The installed presets, each referenced by package name. **Read each preset's
`package.json#facet.hash` at authoring time** and copy it into the level's
`hash` — the validator rejects a mismatch, and hashes change when a profile's
files change. (Values below are a snapshot for orientation, not a source of
truth — re-read or run `pnpm facet spec hash-profile packages/preset-pi-<x>`.)

| Profile ref | Adds | Extra peer dep |
|---|---|---|
| `@facet/preset-pi-default` | Baseline: `read/write/edit/bash` tools, plain SYSTEM.md. No extensions. The control. | — |
| `@facet/preset-pi-subagents` | Subagent delegation (`Agent`, `get_subagent_result`, `steer_subagent`) + pinned `Explore`/`Plan`/`general-purpose` agents + two subagent metrics. | `@tintinweb/pi-subagents` |
| `@facet/preset-pi-graph` | Code-graph navigation. | `pi-gitnexus` |
| `@facet/preset-pi-rag` | Local retrieval-augmented context. | `pi-local-rag` |
| `@facet/preset-pi-lsp` | Language-server-backed navigation/edits. | `@dreki-gg/pi-lsp` |
| `@facet/preset-pi-lens` | `pi-lens` context tooling. | `pi-lens` |

A profile package's `profile/` directory holds `SYSTEM.md` (system prompt),
`tools.yaml` (`tools: [...]` allowlist), optional `extensions.yaml` (Pi
extensions + `pinned_agents` + profile-declared `metrics`), and an optional
`agents/` dir of `.md` sub-agent definitions. To author a *new* profile, switch
to the `extend-facet` playbook.

## Model levels (model_swap)

`provider` is an open string; the harness's model registry is the real gate.
Conventional providers: `openrouter`, `anthropic`, `openai`, `google`, `groq`.
`model_id` is the provider-native id (e.g. `qwen/qwen3.5-9b`,
`google/gemini-2.5-flash-lite`). The runner reads `${PROVIDER}_API_KEY` from the
environment at run time. For models the installed Pi build does not know, Pi can
read a package-local `models.json` at the experiment root — note that as a
follow-up if a chosen model is unknown.

## Classifying history into task types

When mining commits/PRs (SKILL.md steps 2–3), classify candidates so the prompt
and `task_type` are accurate:

| Signal | Likely type |
|---|---|
| `:bug:` / `fix:` prefix, small diff, a new test that reproduces a failure | **bug** |
| `:sparkles:` / `feat:` prefix, new public symbol/file + new tests | **feature** |
| `:recycle:` / `refactor:` prefix, structure change with behavior-preserving tests | **refactor** |
| diff touches several of the above, or a PR bundling them | **compound** |

Prefer changes that **add or modify tests in the same commit/PR** — those tests
become your oracle for free. Prefer self-contained changes (one package/module,
few files) over sprawling ones. Avoid changes whose tests need network,
external services, or non-deterministic timing.

## When the change has no tests (inference)

If the chosen commit/PR ships no tests, you must **infer** the grader from the
diff:

1. Read the diff and state, in one sentence, the behavioral delta (what the code
   does after that it did not do before, or the bug it stops exhibiting).
2. Write minimal tests that assert that delta against `$WS`.
3. **Prove the differential invariant:** the inferred tests must fail on `repo/`
   and pass on `reference_solution/`. If they pass on `repo/`, they don't capture
   the change — tighten them. If they fail on `reference_solution/`, they're
   wrong — fix them. Do not ship until both ends check out.
4. Record in the scenario `README`/`meta` `tags` that the oracle is inferred,
   not author-provided, so downstream analysis knows.
