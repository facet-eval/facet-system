The repository in the current working directory contains `notifier`, a
small Python package implementing a rule-based notification router.

Domain:
- An `Event` is a frozen dataclass with `source: str`, `severity: str`,
  `tags: tuple[str, ...]`, and `message: str`.
- A `Matcher` has a `match(event: Event) -> bool` method. Built-in
  matchers: `SeverityMatcher`, `SourceMatcher`, `AllMatcher` (AND of
  sub-matchers), `AnyMatcher` (OR of sub-matchers).
- A `Rule` couples a matcher with a list of channel names.
- A `Channel` sends an event somewhere (currently: print to stdout).
  Built-in channels: `email`, `slack`, `log`.
- The router applies every matching rule to each event; every matching
  rule's channels fire. Channels print one line per event in the format
  `<NAME>: {source} | {severity} | {message}` (with NAME ∈ {EMAIL,
  SLACK, LOG}).

You have three tasks. They are independent — each is graded separately,
and you may attempt any subset in any order.

1. **Bug fix.** In `notifier/router.py`, `Router.route()` is currently:
       def route(self, event: Event) -> None:
           for rule in self.rules:
               if rule.matcher.match(event):
                   for channel_name in rule.channels:
                       dispatch(event, channel_name)
                   return   # ← bug: stops after first matching rule
   Remove the `return` so iteration continues across all rules. After
   the fix, an event that matches multiple rules must trigger every
   matching rule's channels.

2. **Feature.** Add a `NotMatcher` class to `notifier/matchers.py`:
       class NotMatcher(Matcher):
           def __init__(self, inner: Matcher): ...
           def match(self, event: Event) -> bool:
               return not self.inner.match(event)
   No changes to `cli.py`'s hardcoded rules are required.

3. **Refactor.** Rework `notifier/channels.py` from free functions to a
   class hierarchy + registry:
       class Channel(ABC):
           @abstractmethod
           def send(self, event: Event) -> None: ...

       class EmailChannel(Channel):
           def send(self, event: Event) -> None:
               print(f"EMAIL: {event.source} | {event.severity} | {event.message}")

       # Similarly: SlackChannel, LogChannel.

       CHANNELS: dict[str, Channel] = {
           "email": EmailChannel(),
           "slack": SlackChannel(),
           "log":   LogChannel(),
       }

       def dispatch(event: Event, channel_name: str) -> None:
           channel = CHANNELS.get(channel_name)
           if channel is None:
               raise ValueError(f"Unknown channel: {channel_name}")
           channel.send(event)
   Preserve the exact printed-line format. Do not modify
   `notifier/router.py`.

Run `python -m notifier --help` to verify the package imports and the
CLI starts.
