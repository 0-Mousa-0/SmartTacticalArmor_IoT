#!/usr/bin/env python3
"""Local development server:  python run.py   (http://localhost:5000/api/v1/docs)"""
import logging
import os

from app import create_app
from app.runtime import start_background_services

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = create_app()

if __name__ == "__main__":
    start_background_services(app)
    # No auto-reloader: it would spawn a second process and a second MQTT session.
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=app.config.get("DEBUG", False),
            use_reloader=False)
