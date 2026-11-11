"""Outbound port for delivering commands to vests.

The facade depends on the ``CommandPublisher`` abstraction, not on MQTT, so
the business logic is testable without a broker and the transport can be
swapped (MQTT today; e.g. an HTTP gateway later) without touching it.
"""
import logging
from abc import ABC, abstractmethod

log = logging.getLogger(__name__)


class CommandPublisher(ABC):
    @abstractmethod
    def publish_command(self, device_code: str, message: dict) -> bool:
        """Deliver ``message`` to the vest; True when the broker accepted it."""


class NullCommandPublisher(CommandPublisher):
    """Used when MQTT is disabled: every command fails visibly, never silently."""

    def publish_command(self, device_code: str, message: dict) -> bool:
        log.warning("MQTT disabled — command %s for %s not delivered", message.get("cmd"), device_code)
        return False


class MqttCommandPublisher(CommandPublisher):
    def __init__(self, gateway, topic_root: str):
        self._gateway = gateway
        self._topic_root = topic_root.rstrip("/")

    def publish_command(self, device_code: str, message: dict) -> bool:
        return self._gateway.publish(f"{self._topic_root}/{device_code}/cmd", message, qos=1)


class RecordingCommandPublisher(CommandPublisher):
    """Test double: records every command and returns a configurable result."""

    def __init__(self, succeed: bool = True):
        self.succeed = succeed
        self.sent: list[tuple[str, dict]] = []

    def publish_command(self, device_code: str, message: dict) -> bool:
        self.sent.append((device_code, dict(message)))
        return self.succeed
