---
name: author-scenarios
description: >
  Interactively build a FACET experiment, scenario, and grading oracle from a
  repository's git/GitHub history. Mines commits and PRs, classifies a bug
  fix / feature / refactor, lays its parent tree into repo/ (start state) and
  its own tree into reference_solution/ (goal), turns the change's unit tests
  into the oracle (or infers them when absent), then generates prompts,
  meta.yaml, and spec.yaml and validates the matrix. Use when the user says
  "make a scenario/experiment/benchmark from this repo's history", "turn this
  PR/commit/bug fix into a FACET task", or "generate eval tasks from git".
---

# Author a scenario & experiment from history

Read [`AGENTS.md`](./AGENTS.md) in this folder first — it has the scenario
anatomy, the oracle contract, the **differential-oracle invariant**, and the
spec/meta field reference you will rely on at every step.

This skill is **interactive**. Ask the user the questions in steps 1 and 5;
do not assume model/profile/harness. Confirm before writing files.

## Step 0 — Orient

1. Read one existing scenario end-to-end as a template, e.g.
   `examples/default-qwen-python/scenarios/compound-python/` (its `spec.yaml`,
   `meta.yaml`, `oracle/run.sh`, `prompts/*`, `repo/`, `reference_solution/`).
2. Confirm the **target repository** to mine. It may be:
   - **this** repo (`facet-system`), or
   - a different local repo / a GitHub repo the user names. If external, clone
     it to a scratch dir or use `gh` to read it. Never mine a repo you cannot
     read commit trees from.
3. Confirm where the new experiment package will live (default:
   `examples/<experiment-id>/`).

## Step 1 — Mine the history (git + gh)

Discover candidate changes and classify them (see AGENTS.md "Classifying
history"). Run, in the target repo:

```bash
git log --oneline -40                              # recent commits
git log --oneline --grep='fix\|feat\|refactor' -40  # by conventional type
gh pr list --state merged --limit 30               # merged PRs (if a GitHub remote exists)
```

For promising candidates, inspect the change and **whether it carries tests**:

```bash
git show --stat <sha>                  # files + insertions; look for test files
git show <sha> -- '**/test*' '**/*test*' '**/*spec*'   # the tests in the change
gh pr view <num> --json title,body,files,commits        # PR framing + file list
gh pr diff <num>                                          # full PR diff
```

Build a shortlist of 3–6 candidates, each tagged bug/feature/refactor/compound,
each marked "tests included" or "tests must be inferred", each with a one-line
behavioral summary. Prefer self-contained changes that ship tests (AGENTS.md).

## Step 2 — Let the user pick the change

Present the shortlist and ask the user to choose **one** (a commit SHA or a PR
number) as the basis for the scenario. Record:

- `TARGET` = the change commit (for a PR, its merge/head commit or squash commit).
- `BASE`   = the parent state. For a single commit: `<sha>^`. For a PR: its base
  commit (`gh pr view <num> --json baseRefOid`).
- the touched subtree (the package/module/dir the change spans + what its tests
  import). You will copy only this subtree, not the whole repo.

## Step 3 — Gather the experiment knobs (interactive)

Ask the user, offering the defaults from AGENTS.md:

1. **Model(s)** under test — `provider` + `model_id` per level (e.g.
   `openrouter` / `qwen/qwen3.5-9b`). One or several (each adds a matrix axis).
2. **Profile(s)** — show the **profile catalog**. Enumerate the installed
   presets dynamically so refs/hashes are current:
   ```bash
   for d in packages/preset-pi-*; do \
     node -e "const p=require('./$d/package.json');console.log(p.name, p.facet.hash)"; \
   done
   ```
   Ask which to include (e.g. just `default`, or `default` vs `subagents` to
   measure the effect of subagents). Copy each chosen preset's **exact**
   `package.json#facet.hash` into its `extension_select` level.
3. **Harness** — default `pi` / `@facet/harness-pi`. Set `metadata.harness.version`
   to the installed Pi version (read it; e.g.
   `node -e "console.log(require('@mariozechner/pi-coding-agent/package.json').version)"`
   or match a preset's `harnessVersionRange`).
4. **Prompt levels** — default `underspecified`, `medium`, `specific`.
5. **Design** — `repetitions`, `parallelism`, `timeout_per_run_seconds`,
   `max_tokens_per_run`, `max_total_cost_usd`. Warn the user of the resulting
   **matrix size** (= ∏ factor levels × scenarios × repetitions) and rough cost.

## Step 4 — Materialize repo/ and reference_solution/

Create the scenario directory `scenarios/<scenario-id>/` and lay both states of
the touched subtree. Use `git archive` to extract a tree at a ref without
disturbing the working copy:

```bash
mkdir -p scenarios/<id>/repo scenarios/<id>/reference_solution

# START STATE ← parent
git archive "$BASE"   <subtree-path> | tar -x -C scenarios/<id>/repo --strip-components=<n>
# GOAL STATE  ← change
git archive "$TARGET" <subtree-path> | tar -x -C scenarios/<id>/reference_solution --strip-components=<n>
```

(`--strip-components` so the subtree lands at the scenario root, mirroring the
example layout. Adjust to taste; keep both states structurally identical except
for the changed files.) Remove anything irrelevant (build artifacts, unrelated
packages). Both trees should be importable/runnable on their own.

## Step 5 — Build the oracle

**If the change shipped tests:** extract them into `oracle/tests/`:

```bash
mkdir -p scenarios/<id>/oracle/tests
git show "$TARGET" -- <test-paths>      # confirm the tests
git archive "$TARGET" <test-paths> | tar -x -C scenarios/<id>/oracle/tests --strip-components=<n>
```

Adapt each test to run against the workspace path (`$WS`) rather than an
installed package — set `PYTHONPATH="$WS"` (Python), the right module
resolution (JS/TS), etc.

**If the change shipped no tests:** infer them (AGENTS.md "When the change has no
tests") — read the diff, write minimal tests asserting the behavioral delta.

Then write `oracle/run.sh` following the contract in AGENTS.md (model it on the
example's `run.sh`): one `[task_id] PASS|FAIL` line per graded test, `exit 0`
iff all graded tasks pass, `exit 2` on harness error, advisory
`regression_tests/` excluded from the exit code. Make `run.sh` executable
(`chmod +x`).

## Step 6 — Generate prompts and meta.yaml

Write `prompts/underspecified.md`, `prompts/medium.md`, `prompts/specific.md`
at the three specificity levels (AGENTS.md "Prompt specificity"). Derive them
from the change's intent + the reference solution — symptom-only at the bottom,
file/contract-level in the middle, signature/format-level at the top. Mention
subagents/tools **only** if a selected profile exposes them.

Write `meta.yaml` with `id`, `language`, `task_type` (from the classification),
`prompts[]`, `requires_binaries`, and `task_ids` matching the oracle's emitted
labels. Tag `from-history` and, if applicable, `inferred-oracle`.

## Step 7 — Write spec.yaml

Assemble the matrix per the AGENTS.md skeleton:

- `varying_factors`: a `prompt_swap` axis (the prompt levels), an
  `extension_select` axis (the chosen profiles **with exact hashes**), a
  `model_swap` axis (the chosen models).
- `scenarios[]`: `{ id, ref: "scenarios/<id>", hash: "TBD" }`.
- `design`, `comparisons` (state the question the matrix answers), `metrics`
  (oracle layer wired to `oracle/run.sh`), `analysis.emit`.
- `metadata.harness` from step 3.

## Step 8 — Compute profile hashes (if you authored a new profile)

You normally reuse existing presets, so their hashes are already correct. Only
if this skill created a new profile package, run
`pnpm facet spec hash-profile <profile-package-dir>` and copy the result into
the level's `hash`.

## Step 9 — VERIFY (the acceptance criterion)

Do not declare done until all of these pass:

1. **Differential oracle — the invariant.** Run the oracle against both states:
   ```bash
   bash scenarios/<id>/oracle/run.sh "$PWD/scenarios/<id>/repo"               ; echo "start exit=$?"   # expect non-zero (FAIL)
   bash scenarios/<id>/oracle/run.sh "$PWD/scenarios/<id>/reference_solution" ; echo "goal  exit=$?"   # expect 0 (PASS)
   ```
   Start state must FAIL; goal state must PASS. If not, fix the oracle/trees
   before continuing — this is the whole point of the scenario.
2. **Spec validates:** `pnpm build && pnpm facet spec validate examples/<experiment-id>`.
3. **Smoke run (optional, costs tokens):** `pnpm facet run --single examples/<experiment-id>`
   and confirm a Result Bundle is produced.

Report back: the chosen commit/PR, the matrix shape and size, the two oracle
exit codes proving the invariant, and the `spec validate` output. If you created
a branch, follow the repo conventions (feature branch, conventional commit,
squash merge, no AI attribution) — but do not commit unless asked.

## Hard rules

- **Never** ship a scenario whose oracle passes on `repo/` or fails on
  `reference_solution/`. Verify both ends every time.
- **Never** copy the reference solution verbatim into `specific.md`. Give intent
  and contracts.
- Copy **exact** profile hashes from `package.json#facet.hash`; a stale hash
  fails validation.
- Keep `repo/`/`reference_solution/` scoped to the touched subtree — don't drag
  in the whole repository.
- Don't invent SDK/CLI behavior. If `git archive`/`gh` can't get what you need,
  stop and ask rather than improvising.
