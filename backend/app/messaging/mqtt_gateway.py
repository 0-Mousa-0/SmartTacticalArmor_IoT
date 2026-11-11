"""MQTT gateway — the backend's connection to the broker (EMQX Cloud).

* Subscribes to every vest's telemetry / alert / status / resp topics.
* Publishes operator commands (through ``MqttCommandPublisher``).
* Uses a persistent session (clean_session=False, fixed client id) so QoS-1
  alerts are queued by the broker while this service is asleep or
  redeploying, and delivered when it reconnects.
* paho runs its network loop in a background thread; every message is
  handled inside its own Flask app context and DB session.
"""
import json
import logging
import threading

import certifi
import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

from app.extensions import db
from app.messaging.dispatcher import MessageDispatcher
from app.messaging.topics import subscriptions
from app.models.base_model import iso, utcnow

log = logging.getLogger(__name__)


class MqttGateway:
    def __init__(self, app):
        self._app = app
        cfg = app.config
        self._host = cfg["MQTT_HOST"]
        self._port = cfg["MQTT_PORT"]
        self._keepalive = cfg["MQTT_KEEPALIVE_S"]
        self._root = cfg["MQTT_TOPIC_ROOT"]
        self._dispatcher = MessageDispatcher(self._root)
        self._lock = threading.Lock()

        self.connected = False
        self.last_message_at = None
        self.last_connected_at = None
        self.last_error: str | None = None
        self.messages_received = 0

        client = mqtt.Client(
            callback_api_version=CallbackAPIVersion.VERSION2,
            client_id=cfg["MQTT_CLIENT_ID"],
            clean_session=cfg["MQTT_CLEAN_SESSION"],
            protocol=mqtt.MQTTv311,
        )
        if cfg["MQTT_USERNAME"]:
            client.username_pw_set(cfg["MQTT_USERNAME"], cfg["MQTT_PASSWORD"])
        if cfg["MQTT_TLS"]:
            client.tls_set(ca_certs=cfg["MQTT_CA_CERTS"] or certifi.where())
        client.reconnect_delay_set(min_delay=1, max_delay=60)
        client.on_connect = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.on_message = self._on_message
        self._client = client

    # ── lifecycle ────────────────────────────────────────────
    def start(self) -> None:
        if not self._host:
            log.error("MQTT_ENABLED is true but MQTT_HOST is empty — gateway not started")
            self.last_error = "MQTT_HOST not configured"
            return
        log.info("MQTT gateway connecting to %s:%s", self._host, self._port)
        self._client.connect_async(self._host, self._port, keepalive=self._keepalive)
        self._client.loop_start()

    def stop(self) -> None:
        try:
            self._client.disconnect()
        finally:
            self._client.loop_stop()

    # ── outbound ─────────────────────────────────────────────
    def publish(self, topic: str, message: dict, qos: int = 1, timeout_s: float = 4.0) -> bool:
        if not self.connected:
            return False
        body = json.dumps(message, separators=(",", ":"))
        with self._lock:
            info = self._client.publish(topic, body, qos=qos)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            return False
        try:
            info.wait_for_publish(timeout=timeout_s)
        except (RuntimeError, ValueError):
            return False
        return info.is_published()

    def health(self) -> dict:
        return {
            "enabled": True,
            "connected": self.connected,
            "broker": f"{self._host}:{self._port}",
            "last_connected_at": iso(self.last_connected_at),
            "last_message_at": iso(self.last_message_at),
            "messages_received": self.messages_received,
            "last_error": self.last_error,
        }

    # ── paho callbacks (network thread) ──────────────────────
    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            self.connected = False
            self.last_error = f"connect refused: {reason_code}"
            log.error("MQTT connect refused: %s", reason_code)
            return
        self.connected = True
        self.last_error = None
        self.last_connected_at = utcnow()
        client.subscribe(subscriptions(self._root))
        log.info("MQTT connected (session present: %s)", getattr(flags, "session_present", "?"))

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        self.connected = False
        if reason_code is not None and reason_code.is_failure:
            self.last_error = f"disconnected: {reason_code}"
            log.warning("MQTT disconnected: %s (paho will reconnect)", reason_code)

    def _on_message(self, client, userdata, message):
        received_at = utcnow()
        self.last_message_at = received_at
        self.messages_received += 1
        with self._app.app_context():
            try:
                self._dispatcher.dispatch(message.topic, message.payload, retained=bool(message.retain),
                                          received_at=received_at)
            except Exception:  # noqa: BLE001 — one bad message must not kill the loop
                log.exception("failed to process MQTT message on %s", message.topic)
                db.session.rollback()
            finally:
                db.session.remove()
