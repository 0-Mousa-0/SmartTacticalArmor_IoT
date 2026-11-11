"""Routes one inbound MQTT message to the matching facade use case.

This is the messaging counterpart of an API namespace: it translates
transport details (topic, bytes, retain flag) into a facade call and maps
failures to log lines. A bad message is dropped; it never stops ingestion.
"""
import json
import logging
from datetime import datetime

from app.messaging.topics import parse_topic
from app.models.base_model import utcnow
from app.services.facade import FacadeError, get_facade
from app.services.ingest import PayloadError

log = logging.getLogger(__name__)


class MessageDispatcher:
    def __init__(self, topic_root: str):
        self.topic_root = topic_root

    def dispatch(self, topic: str, payload: bytes, *, retained: bool = False,
                 received_at: datetime | None = None) -> str:
        parsed = parse_topic(topic, self.topic_root)
        if parsed is None:
            log.debug("ignored topic %s", topic)
            return "ignored"
        try:
            data = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            log.warning("invalid JSON on %s", topic)
            return "invalid"

        facade = get_facade()
        received_at = received_at or utcnow()
        try:
            if parsed.channel == "telemetry":
                facade.ingest_telemetry(parsed.device_code, data, received_at)
            elif parsed.channel == "alert":
                facade.ingest_device_alert(parsed.device_code, data, received_at)
            elif parsed.channel == "status":
                facade.ingest_status(parsed.device_code, data, received_at, retained=retained)
            elif parsed.channel == "resp":
                facade.ingest_command_response(parsed.device_code, data, received_at)
        except PayloadError as error:
            log.warning("rejected %s message from %s: %s", parsed.channel, parsed.device_code, error)
            return "rejected"
        except FacadeError as error:
            log.info("skipped %s message from %s: %s", parsed.channel, parsed.device_code, error.message)
            return "skipped"
        except ValueError as error:  # model validation
            log.warning("invalid %s message from %s: %s", parsed.channel, parsed.device_code, error)
            return "rejected"
        return "ok"
