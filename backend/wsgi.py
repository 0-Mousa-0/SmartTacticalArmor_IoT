"""Production entry point (gunicorn wsgi:app) — also used by the flask CLI.

Background services start here, inside the gunicorn worker (preload_app is
off), so the MQTT network thread lives in the process that serves requests.
"""
import logging
import os
import sys

from app import create_app
from app.runtime import start_background_services

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = create_app()

# `flask --app wsgi db upgrade` / CLI commands import this module too; they
# must not open an MQTT session.
if "flask" not in os.path.basename(sys.argv[0]).lower():
    start_background_services(app)
