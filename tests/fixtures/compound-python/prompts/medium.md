The repository in the current working directory contains `notifier`, a
small Python package implementing a rule-based notification router.
Events (with source, severity, tags, message) are matched against a
list of rules; matching rules dispatch their channels (email, slack,
log). See README.md for the full semantics.

You have three tasks. They are independent — each is graded separately,
and you may attempt any subset in any order.

1. **Bug fix.** The `Router.route()` method in `notifier/router.py`
   stops iterating after the first rule that matches an event, but the
   contract (per README) says every matching rule must dispatch its
   channels. Fix the routing so all matching rules fire for each event.

2. **Feature.** Add a `NotMatcher` class to `notifier/matchers.py` that
   negates an inner matcher. The CLI's hardcoded rules do not need to
   change; only the matcher class itself is required for this task.
   `NotMatcher(inner).match(event)` must return the negation of
   `inner.match(event)`.

3. **Refactor.** The `notifier/channels.py` module currently uses a
   hand-rolled if/elif ladder in `dispatch()` over three free functions
   (`send_email`, `send_slack`, `send_log`). Refactor it into a
   `Channel` abstract base class with three concrete subclasses, plus a
   `CHANNELS` dict mapping channel names to instances. Keep
   `dispatch()` as a thin wrapper so `notifier/router.py` does not need
   to change. The printed line format for each channel must be
   preserved exactly.

Run `python -m notifier --help` to verify the package imports and the
CLI starts.
