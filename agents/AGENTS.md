# AGENTS.md — facet-system

Guidance for **any** coding agent (Codex, Cursor, Claude Code, Aider, …) working
in this repository. Read this file first. It is intentionally tool-agnostic:
where it says "run `git`", use whatever shell access you have; where it says
"ask the user", use whatever interaction channel you have.

## What FACET is

FACET is an extensible framework for evaluating code agents. It treats every
"knob" of an agent — model, tool allowlist, system prompt, extensions, agent
definitions, prompt, scenario, and harness-level params — as a **declarable
independent variable**, then runs a deterministic matrix of those variables to
produce a verifiable, reproducible **Result Bundle** per experiment.

You drive FACET by authoring two kinds of artifact and running the CLI over them:

- an **experiment package** — a directory with a `spec.yaml` (the matrix) plus
  one or more **scenario** directories (the tasks the agent must solve);
- optionally an **extension** — a profile package, a new harness, or a plugin
  that contributes a new factor kind / metric kind / evaluator layer / output
  emitter / workspace strategy / trace event kind.

## Package map (canonical names — use these everywhere)

| Package | Role | Imports |
|---|---|---|
| `@facet/sdk` | **Public extension contract.** Pure interfaces + `defineX()` identity helpers for every seam. Zero runtime deps (`zod` peer only). Anyone extending FACET imports the SDK. | nothing |
| `@facet/core` | **Framework runtime.** Runner, validator, tracer, registries, bundle writer, CLI (`facet spec validate/run/hash-profile`), and the eager-registered builtins. Consumes the SDK like any third party. | `@facet/sdk` |
| `@facet/harness-pi` | **Concrete harness adapter** for the Pi coding agent. Translates Pi-native events into FACET `TraceEvent`s and registers Pi-specific metric kinds + extensions-contributions. One of N possible harnesses. | `@facet/sdk`, Pi SDK |
| `@facet/preset-pi-{default,graph,rag,lsp,lens,subagents}` | **Distributable profile packages.** Each is an npm package with `package.json#facet = {profileRoot, harness, harnessVersionRange, hash}` + a `profile/` directory. A spec references them by package name. | `@facet/harness-pi` (peer) |

The CLI dynamically imports `spec.metadata.harness.package`, calls its optional
`register(registries)` hook, then imports any `spec.metadata.plugins[]` entries
and calls their `register(registries)` hooks. After that the registries are
populated and the spec parser composes the active schemas. **Everything
plugin-able lands via this path** — metric kinds, factor kinds, trace event
kinds, evaluator layers, output emitters, workspace strategies.

Design invariant: no `packages/core/` file names a specific profile, harness,
provider, scenario shape, output format, or harness-specific metric kind.
Anything that does is an extension.

## The two agent playbooks in this folder

This `agents/` directory is split by domain. Each subfolder has an `AGENTS.md`
(domain reference: anatomy, contracts, invariants) and a `SKILL.md` (the
step-by-step procedure you execute):

| Folder | Use it to… |
|---|---|
| [`author-scenarios/`](./author-scenarios/AGENTS.md) | Mine this (or any) repo's git/GitHub history and **automatically build an experiment + scenario + grading tests** from a real bug fix / feature / refactor. The old commit becomes the start state; the fixed state becomes the goal; the change's unit tests become the oracle. |
| [`extend-facet/`](./extend-facet/AGENTS.md) | **Extend, customize, and work with FACET internals** — add a new harness, profile package, factor kind, metric kind, evaluator layer, output emitter, workspace strategy, or trace event kind. |

If the user's request is "make me an experiment / test / scenario from this
repo's history" → `author-scenarios`. If it's "add support for X to FACET / a
new profile / a new metric" → `extend-facet`.

## Commands you will use

```bash
pnpm install              # install workspace (once)
pnpm build                # tsc across all packages — REQUIRED before the CLI sees src changes
pnpm test                 # vitest
pnpm lint:deadcode        # ts-prune dead-export gate (annotate public exports with // ts-prune-ignore-next)

# CLI (runs dist/, so build first after editing core/runner/schema)
pnpm facet spec show      <experiment-package-dir>
pnpm facet spec validate  <experiment-package-dir>
pnpm facet spec hash-profile <profile-package-dir>     # recompute package.json#facet.hash
pnpm facet run            <experiment-package-dir>      # full matrix → Result Bundle
pnpm facet run --single   <experiment-package-dir>      # first cell only (debug)
```

Environment: copy `.env.example` (or create `.env`) and set `${PROVIDER}_API_KEY`
for each provider your spec's `model_swap` factor declares (e.g.
`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`). Never commit `.env`.

## Repository conventions (non-negotiable)

These come from `CONTRIBUTING.md` and the project rules. Honor them whether or
not the human restates them:

1. **Trunk-based.** `main` is the only long-lived branch and must always build +
   pass tests. **Never commit on `main`.** Branch for every change, even a
   one-line docs fix. Prefixes: `feature/ fix/ docs/ test/ refactor/ chore/`.
2. **Conventional Commits + Gitmoji:** `<gitmoji> <type>(<scope>): <summary>`.
   Examples: `:sparkles: feat(core): add plugin loader diagnostics`,
   `:bug: fix(harness-pi): handle unknown context window`.
3. **Squash-and-merge only.** No merge commits, no rebase merges. Delete branches
   after merge.
4. **No AI attribution** in commits or PR bodies — no "Co-Authored-By: Claude",
   no "Generated with", no robot emoji, no "Anthropic". Hard rule.
5. **English everywhere** — code, comments, identifiers, commits, docs.
6. **Strict TypeScript.** `"strict": true`. No implicit `any`. No `@ts-ignore`
   without a justifying comment. Mark intentional public exports with
   `// ts-prune-ignore-next` so the dead-code gate stays clean.
7. **Don't commit** secrets, `.env`, `node_modules`, generated `dist`, or result
   bundles (`result-*/`).
8. **Before opening a PR:** `pnpm install --frozen-lockfile && pnpm build && pnpm test`.

## How to behave

- **Read before writing.** The fastest way to get a scenario or extension right
  is to imitate an existing one. For scenarios: read `examples/`. For
  extensions: read the matching `packages/core/src/builtins/**` and the
  `@facet/sdk` seam file.
- **Stop on uncertainty.** If the SDK does not expose what you assumed, do not
  parse stdout, invent APIs, or ship a silent workaround. Surface the gap and
  ask.
- **Don't expand scope.** Build exactly what was requested. No speculative
  scaffolding.
- **Every deliverable ends with a verifiable command** whose output you can
  show — `pnpm facet spec validate …`, an oracle exit code, a passing test.
