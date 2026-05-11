"""Regression test 3: dispatch() raises ValueError on unknown channel.

Run as: PYTHONPATH=<workspace> python test_dispatch_unknown.py
Exits 0 on success, non-zero on failure.
"""
import sys
import traceback


def main() -> int:
    try:
        from notifier.channels import dispatch  # type: ignore
        from notifier.event import Event  # type: ignore
    except ImportError as exc:
        print(f"reg3: import failed: {exc}", file=sys.stderr)
        return 1

    ev = Event(source="x", severity="info", tags=(), message="")
    try:
        dispatch(ev, "not_a_channel")
    except ValueError:
        return 0
    except Exception:
        traceback.print_exc()
        return 1

    print("reg3: dispatch did not raise on unknown channel", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
