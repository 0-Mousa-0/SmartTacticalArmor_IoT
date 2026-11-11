"""Background thread that runs ``facade.run_housekeeping()`` periodically."""
import logging
import threading

from app.extensions import db
from app.services.facade import get_facade

log = logging.getLogger(__name__)


class Housekeeper(threading.Thread):
    def __init__(self, app, interval_s: int):
        super().__init__(name="sta-housekeeper", daemon=True)
        self._app = app
        self._interval_s = max(5, interval_s)
        self._stop_event = threading.Event()

    def run(self) -> None:
        while not self._stop_event.wait(self._interval_s):
            with self._app.app_context():
                try:
                    summary = get_facade().run_housekeeping()
                    if any(summary.values()):
                        log.info("housekeeping: %s", summary)
                except Exception:  # noqa: BLE001
                    log.exception("housekeeping failed")
                    db.session.rollback()
                finally:
                    db.session.remove()

    def stop(self) -> None:
        self._stop_event.set()
