# facet-system

FACET is an extensible framework for evaluating code agents across controlled
experiment factors, harnesses, traces, metrics, and output bundles.

This repository is the FACET system monorepo. It currently keeps the SDK, core
runtime, Pi harness, Pi presets, examples, and tests together so development can
move against one coherent contract and one CI suite.

## Maturity

This project is early-stage research and framework infrastructure. Package APIs,
spec schemas, trace events, bundle formats, and presets may change while the
system is being stabilized.

## Requirements

- Node.js 22 or newer
- pnpm 9

## Quick Start

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Run the FACET CLI after building:

```bash
pnpm facet --help
```

## Repository Map

- `packages/sdk`: public extension contracts and `define*` helpers.
- `packages/core`: validator, runner, tracer, bundle writer, evaluator, builtins,
  and CLI.
- `packages/harness-pi`: reference harness adapter for the Pi coding agent.
- `packages/preset-pi-*`: curated Pi profile presets used by the reference
  harness and tests.
- `examples/hello-world-experiment`: minimal runnable experiment shape.
- `examples/default-qwen-python`: small Pi-backed example for smoke testing.
- `tests/framework`: framework contract, runner, tracer, registry, bundle, and
  adapter tests.
- `tests/experiment-packages`: integration tests for specs and profile packages.
- `tests/fixtures`: test fixtures and trace samples.

## Development

This repository uses trunk-based development. After the initial commit, all
changes should enter through pull requests, pass CI, and be merged with squash
merge only.

Before opening a PR:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

See `CONTRIBUTING.md` for branch, commit, merge, and repository hygiene rules.
