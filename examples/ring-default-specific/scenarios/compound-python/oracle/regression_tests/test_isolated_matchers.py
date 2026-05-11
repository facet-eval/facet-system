"""Regression test 1: existing matcher classes (Source, All, Any) work in
isolation against inputs distinct from the hardcoded rules.

Run as: PYTHONPATH=<workspace> python test_isolated_matchers.py
Exits 0 on success, non-zero on failure.
"""
import sys
import traceback


def main() -> int:
    try:
        from notifier.event import Event  # type: ignore
        from notifier.matchers import (  # type: ignore
            AllMatcher,
            AnyMatcher,
            SeverityMatcher,
            SourceMatcher,
        )
    except ImportError as exc:
        print(f"reg1: import failed: {exc}", file=sys.stderr)
        return 1

    try:
        # SourceMatcher with multi-element set distinct from the hardcoded rules.
        src = SourceMatcher({"x", "y", "z"})
        assert src.match(Event(source="y", severity="info", tags=(), message="")) is True
        assert src.match(Event(source="w", severity="info", tags=(), message="")) is False

        # AllMatcher truth table.
        all_m = AllMatcher([SeverityMatcher({"info"}), SourceMatcher({"x"})])
        assert all_m.match(Event(source="x", severity="info", tags=(), message="")) is True
        assert all_m.match(Event(source="x", severity="warn", tags=(), message="")) is False
        assert all_m.match(Event(source="y", severity="info", tags=(), message="")) is False
        assert all_m.match(Event(source="y", severity="warn", tags=(), message="")) is False

        # AnyMatcher truth table.
        any_m = AnyMatcher([SeverityMatcher({"info"}), SourceMatcher({"x"})])
        assert any_m.match(Event(source="x", severity="info", tags=(), message="")) is True
        assert any_m.match(Event(source="x", severity="warn", tags=(), message="")) is True
        assert any_m.match(Event(source="y", severity="info", tags=(), message="")) is True
        assert any_m.match(Event(source="y", severity="warn", tags=(), message="")) is False
    except Exception:
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
