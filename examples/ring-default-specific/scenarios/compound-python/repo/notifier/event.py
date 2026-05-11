from dataclasses import dataclass


@dataclass(frozen=True)
class Event:
    source: str
    severity: str
    tags: tuple[str, ...]
    message: str
