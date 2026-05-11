# Hello World Experiment

Minimal experiment package for the facet walking skeleton.

- 1 scenario: `fizzbuzz-off-by-one` (TypeScript bug fix)
- 2 prompt variants: `underspecified`, `specific`
- 1 profile: `default` (Pi defaults)
- 1 model: `qwen-2.5-coder-7b-instruct` via OpenRouter
- 2 repetitions → 4 runs total

Run:

```bash
export OPENROUTER_API_KEY=...
pnpm facet run examples/hello-world-experiment
```
