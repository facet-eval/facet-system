# Contributing to facet-system

Thanks for contributing. This repository uses trunk-based development,
Conventional Commits, Gitmoji, and squash-only merges.

## Development model

- `main` is the only long-lived branch.
- Create short-lived branches from `main`.
- Open a pull request for every change after the initial commit.
- Keep PRs small and focused.
- Delete branches after merge.

Allowed branch prefixes:

- `feature/<topic>`
- `fix/<topic>`
- `docs/<topic>`
- `test/<topic>`
- `refactor/<topic>`
- `chore/<topic>`

## Merge policy

Only **Squash and merge** is allowed.

Do not use merge commits. Do not use rebase merges unless maintainers change
this policy later. The squash commit title must follow the commit message
format below.

## Commit messages

Use Conventional Commits with Gitmoji:

```text
<gitmoji> <type>(<scope>): <summary>
```

Examples:

```text
:sparkles: feat(core): add plugin loader diagnostics
:bug: fix(harness-pi): handle unknown context window
:memo: docs(sdk): clarify harness adapter contract
:white_check_mark: test(runner): cover budget cancellation
```

The initial repository upload must be a single commit:

```text
:tada: chore: initial commit
```

## Before opening a PR

Run:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

If a command cannot be run locally, say so in the PR and explain why.

## Issue quality

Issues should be actionable. Follow the templates and include:

- clear title
- expected behavior
- actual behavior or proposal
- reproduction steps for bugs
- affected package or component
- environment details when relevant
- acceptance criteria for features

## Pull request quality

Every PR should include:

- concise summary
- linked issue or design note
- test evidence
- risk or migration notes when relevant

Avoid unrelated formatting or refactors in feature/fix PRs.

## Repository hygiene

Do not commit:

- secrets or API keys
- `.env`
- `node_modules`
- generated `dist`
- result bundles
- local Pi/Codex/Claude agent state
- large research artifacts unless explicitly approved

## License

By contributing, you agree that your contribution is provided under this
repository's license.
