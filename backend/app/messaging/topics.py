"""MQTT topic scheme: ``<root>/<device_code>/<channel>`` (root = ``sta/v1``)."""
from dataclasses import dataclass

from app.utils.validators import DEVICE_CODE_RE

INBOUND_CHANNELS = {"telemetry": 0, "alert": 1, "status": 1, "resp": 1}  # channel -> subscribe QoS


@dataclass(frozen=True)
class ParsedTopic:
    device_code: str
    channel: str


def parse_topic(topic: str, root: str) -> ParsedTopic | None:
    root = root.strip("/")
    if not topic.startswith(root + "/"):
        return None
    parts = topic[len(root) + 1:].split("/")
    if len(parts) != 2:
        return None
    device_code, channel = parts
    if not DEVICE_CODE_RE.match(device_code) or channel not in INBOUND_CHANNELS:
        return None
    return ParsedTopic(device_code.upper(), channel)


def subscriptions(root: str) -> list[tuple[str, int]]:
    root = root.strip("/")
    return [(f"{root}/+/{channel}", qos) for channel, qos in INBOUND_CHANNELS.items()]


def command_topic(root: str, device_code: str) -> str:
    return f"{root.strip('/')}/{device_code}/cmd"
