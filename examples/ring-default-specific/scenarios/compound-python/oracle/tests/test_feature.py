"""Task 2 (feature): NotMatcher must exist and negate its inner matcher.

Run as: PYTHONPATH=<workspace> python test_feature.py
Exits 0 on success, non-zero on failure.
"""
import sys
import traceback


def main() -> int:
    try:
        from notifier.matchers import NotMatcher, SeverityMatcher  # type: ignore
        from notifier.event import Event  # type: ignore
    except ImportError as exc:
        print(f"task2: import failed: {exc}", file=sys.stderr)
        return 1

    try:
        sev_info = SeverityMatcher({"info"})
        not_info = NotMatcher(sev_info)
        info_event = Event(source="api", severity="info", tags=(), message="")
        err_event = Event(source="api", severity="error", tags=(), message="")

        assert sev_info.match(info_event) is True
        assert sev_info.match(err_event) is False
        assert not_info.match(info_event) is False
        assert not_info.match(err_event) is True
    except Exception:
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
