import argparse
import json
import sys
from pathlib import Path

from .event import Event
from .matchers import AllMatcher, AnyMatcher, SeverityMatcher, SourceMatcher
from .router import Router
from .rule import Rule

RULES: list[Rule] = [
    Rule(
        matcher=AllMatcher(
            [
                SeverityMatcher({"error", "critical"}),
                SourceMatcher({"api", "build-system"}),
            ]
        ),
        channels=["email", "log"],
    ),
    Rule(
        matcher=AnyMatcher(
            [
                SeverityMatcher({"critical"}),
                SourceMatcher({"deploy"}),
            ]
        ),
        channels=["slack"],
    ),
]


def _read_events(path: Path) -> list[Event]:
    events: list[Event] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            events.append(
                Event(
                    source=obj["source"],
                    severity=obj["severity"],
                    tags=tuple(obj.get("tags", ())),
                    message=obj["message"],
                )
            )
    return events


def main() -> None:
    parser = argparse.ArgumentParser(prog="notifier")
    parser.add_argument(
        "--events",
        required=True,
        type=Path,
        help="Path to a JSONL file of events.",
    )
    args = parser.parse_args()

    if not args.events.exists():
        print(f"events file not found: {args.events}", file=sys.stderr)
        sys.exit(2)

    events = _read_events(args.events)
    router = Router(RULES)
    for event in events:
        router.route(event)


if __name__ == "__main__":
    main()
