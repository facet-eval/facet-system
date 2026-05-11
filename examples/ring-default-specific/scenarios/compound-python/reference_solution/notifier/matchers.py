from abc import ABC, abstractmethod

from .event import Event


class Matcher(ABC):
    @abstractmethod
    def match(self, event: Event) -> bool:
        ...


class SeverityMatcher(Matcher):
    def __init__(self, severities: set[str]) -> None:
        self.severities = set(severities)

    def match(self, event: Event) -> bool:
        return event.severity in self.severities


class SourceMatcher(Matcher):
    def __init__(self, sources: set[str]) -> None:
        self.sources = set(sources)

    def match(self, event: Event) -> bool:
        return event.source in self.sources


class AllMatcher(Matcher):
    def __init__(self, matchers: list[Matcher]) -> None:
        self.matchers = list(matchers)

    def match(self, event: Event) -> bool:
        return all(m.match(event) for m in self.matchers)


class AnyMatcher(Matcher):
    def __init__(self, matchers: list[Matcher]) -> None:
        self.matchers = list(matchers)

    def match(self, event: Event) -> bool:
        return any(m.match(event) for m in self.matchers)


class NotMatcher(Matcher):
    def __init__(self, inner: Matcher) -> None:
        self.inner = inner

    def match(self, event: Event) -> bool:
        return not self.inner.match(event)
