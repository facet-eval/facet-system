# default-qwen-python

Minimal FACET experiment that measures how prompt specificity affects the
**default** profile on a **Python compound** coding task with
**qwen3.5-9b**.

This is a focused slice of `examples/subagent-routing-qwen` — using
qwen3.5-9b instead of qwen-3.6-35b-a3b, same subagent-aware prompts,
but only one scenario and one profile.

## Matrix

| Factor | Levels | Count |
|---|---|---|
| `prompt_id` | underspecified, medium, specific | 3 |
| `profile` | `@facet/preset-pi-default` | 1 |
| `model` | qwen3.5-9b (OpenRouter) | 1 |
| `scenario` | compound-python | 1 |
| `repetitions` | 1 | 1 |
| **Total runs** | | **3** |

Budget cap: `max_total_cost_usd: 1.0`.

## Scenarios

The scenario directory mirrors the structure used by
`examples/factor-study/scenarios/compound-python/`. The three heavy
subdirectories (`repo/`, `oracle/`, `reference_solution/`) are
symlinked back to `factor-study` to avoid duplication.

## Prompt design

The user prompts at all three specificity levels are the subagent-aware
variants from `subagent-routing-qwen`. Since only the default profile is
used (which does not expose the `Agent` tool), the subagent mentions serve
as a form of irrelevant instruction — part of the prompt content held
constant.

## Comparisons

- `prompt_specificity` — how does prompt specificity affect correctness
  for the default profile on a Python compound task?

## Running

```bash
pnpm facet spec validate examples/default-qwen-python
pnpm facet run examples/default-qwen-python
```

Results land in a fresh `result-default-qwen-python-001-<TS>/`
directory at the repo root.
