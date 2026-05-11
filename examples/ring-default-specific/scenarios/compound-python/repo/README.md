# notifier

A small Python package implementing a rule-based notification router.

## Domain

- **Event**: a frozen dataclass with `source: str`, `severity: str`,
  `tags: tuple[str, ...]`, and `message: str`.
- **Matcher**: an abstract base class with `match(event: Event) -> bool`.
  Built-in matchers:
  - `SeverityMatcher(severities: set[str])`
  - `SourceMatcher(sources: set[str])`
  - `AllMatcher(matchers: list[Matcher])` — AND of sub-matchers
  - `AnyMatcher(matchers: list[Matcher])` — OR of sub-matchers
- **Rule**: a dataclass coupling a `Matcher` with a list of channel names.
- **Channel**: every channel prints exactly one line per event in the
  format `<NAME>: {source} | {severity} | {message}` (with NAME ∈ {EMAIL,
  SLACK, LOG}). Built-in channel names: `email`, `slack`, `log`.

## Routing contract

Each event is checked against every rule. **Every rule whose matcher
matches dispatches to its channels.** All matching rules fire — not
just the first.

## Hardcoded rules

The CLI ships with two hardcoded rules in `notifier/cli.py`:

1. Severity ∈ {error, critical} **and** source ∈ {api, build-system}
   → dispatch to `email`, `log`.
2. Severity ∈ {critical} **or** source ∈ {deploy}
   → dispatch to `slack`.

## CLI

```bash
python -m notifier --events <path>
```

The `--events` argument is a path to a JSONL file: one JSON object per
line, each line with the fields `source`, `severity`, `tags`, `message`.
For each event, the router prints the lines emitted by every matching
rule's channels.
