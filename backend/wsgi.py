"""Production entry point (gunicorn wsgi:app) — also used by the flask CLI.

Importing this module only builds the app. Background services (MQTT
ingestion, housekeeping) start in the gunicorn worker through the
post_worker_init hook in gunicorn.conf.py, so `flask --app wsgi ...`
commands and a preloading gunicorn master never open an MQTT session.
"""
import logging
import os

from app import create_app

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = create_app()
