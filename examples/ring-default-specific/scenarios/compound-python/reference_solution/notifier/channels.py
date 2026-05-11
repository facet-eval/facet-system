from abc import ABC, abstractmethod

from .event import Event


class Channel(ABC):
    @abstractmethod
    def send(self, event: Event) -> None: ...


class EmailChannel(Channel):
    def send(self, event: Event) -> None:
        print(f"EMAIL: {event.source} | {event.severity} | {event.message}")


class SlackChannel(Channel):
    def send(self, event: Event) -> None:
        print(f"SLACK: {event.source} | {event.severity} | {event.message}")


class LogChannel(Channel):
    def send(self, event: Event) -> None:
        print(f"LOG: {event.source} | {event.severity} | {event.message}")


CHANNELS: dict[str, Channel] = {
    "email": EmailChannel(),
    "slack": SlackChannel(),
    "log": LogChannel(),
}


def dispatch(event: Event, channel_name: str) -> None:
    channel = CHANNELS.get(channel_name)
    if channel is None:
        raise ValueError(f"Unknown channel: {channel_name}")
    channel.send(event)
