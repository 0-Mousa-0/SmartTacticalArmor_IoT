"""Starts the long-running background services of one API process.

Called from ``wsgi.py`` (gunicorn) and ``run.py`` (local dev) — never from
``create_app()``, so ``flask db upgrade``, tests and CLI commands do not open
MQTT connections.
"""
import atexit
import logging

from app.messaging.housekeeper import Housekeeper
from app.messaging.mqtt_gateway import MqttGateway
from app.services.facade import EXTENSION_KEY
from app.services.providers import MqttCommandPublisher

log = logging.getLogger(__name__)
_started_key = "sta.runtime.started"


def start_background_services(app) -> None:
    if app.extensions.get(_started_key):
        return
    app.extensions[_started_key] = True

    with app.app_context():
        try:
            from app.services.facade import get_facade
            if get_facade().ensure_bootstrap_admin():
                log.info("bootstrap administrator created from environment variables")
        except Exception:  # noqa: BLE001 — never block startup on this
            log.exception("bootstrap admin check failed (are migrations applied?)")

    if not app.config["MQTT_ENABLED"]:
        log.info("MQTT ingestion disabled (MQTT_ENABLED=false)")
        return

    facade = app.extensions[EXTENSION_KEY]
    gateway = MqttGateway(app)
    facade.gateway = gateway
    facade.publisher = MqttCommandPublisher(gateway, app.config["MQTT_TOPIC_ROOT"])
    gateway.start()

    housekeeper = Housekeeper(app, app.config["HOUSEKEEPING_INTERVAL_S"])
    housekeeper.start()

    def _shutdown():
        housekeeper.stop()
        gateway.stop()

    atexit.register(_shutdown)
