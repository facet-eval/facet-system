from .channels import dispatch
from .event import Event
from .rule import Rule


class Router:
    def __init__(self, rules: list[Rule]) -> None:
        self.rules = rules

    def route(self, event: Event) -> None:
        for rule in self.rules:
            if rule.matcher.match(event):
                for channel_name in rule.channels:
                    dispatch(event, channel_name)
                return
