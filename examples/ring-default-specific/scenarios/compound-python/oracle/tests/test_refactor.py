"""Task 3 (refactor): channels must expose Channel ABC + CHANNELS registry.

Run as: PYTHONPATH=<workspace> python test_refactor.py
Exits 0 on success, non-zero on failure.
"""
import contextlib
import inspect
import io
import sys
import traceback


def main() -> int:
    try:
        from notifier.channels import CHANNELS, Channel  # type: ignore
        from notifier.event import Event  # type: ignore
    except ImportError as exc:
        print(f"task3: import failed: {exc}", file=sys.stderr)
        return 1

    try:
        # Channel must be an ABC with a `send` method.
        assert inspect.isabstract(Channel) or hasattr(Channel, "send"), (
            "Channel must be an ABC or expose `send`"
        )

        # Registry must include at least the three default names.
        assert set(CHANNELS.keys()) >= {"email", "slack", "log"}, (
            f"CHANNELS missing expected keys: {set(CHANNELS.keys())}"
        )
        for name, channel in CHANNELS.items():
            assert isinstance(channel, Channel), (
                f"CHANNELS[{name!r}] is not a Channel instance"
            )

        # The email channel's send must produce the documented format.
        ev = Event(source="api", severity="error", tags=(), message="boom")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            CHANNELS["email"].send(ev)
        text = buf.getvalue()
        for needle in ("EMAIL:", "api", "error", "boom"):
            assert needle in text, (
                f"email send output missing {needle!r}: got {text!r}"
            )
    except Exception:
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
