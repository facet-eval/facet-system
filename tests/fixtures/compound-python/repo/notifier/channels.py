from .event import Event


def send_email(event: Event) -> None:
    print(f"EMAIL: {event.source} | {event.severity} | {event.message}")


def send_slack(event: Event) -> None:
    print(f"SLACK: {event.source} | {event.severity} | {event.message}")


def send_log(event: Event) -> None:
    print(f"LOG: {event.source} | {event.severity} | {event.message}")


def dispatch(event: Event, channel_name: str) -> None:
    if channel_name == "email":
        send_email(event)
    elif channel_name == "slack":
        send_slack(event)
    elif channel_name == "log":
        send_log(event)
    else:
        raise ValueError(f"Unknown channel: {channel_name}")
