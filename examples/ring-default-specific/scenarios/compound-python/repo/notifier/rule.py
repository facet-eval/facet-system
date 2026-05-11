from dataclasses import dataclass, field

from .matchers import Matcher


@dataclass
class Rule:
    matcher: Matcher
    channels: list[str] = field(default_factory=list)
