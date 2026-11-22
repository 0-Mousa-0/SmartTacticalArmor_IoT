"""gunicorn settings for Render.

One worker process on purpose: it owns the single MQTT session (persistent,
fixed client id) and the in-memory login rate limiter. Threads give request
concurrency; the free instance has 512 MB RAM.
"""
import os

bind = f"0.0.0.0:{os.getenv('PORT', '5000')}"
workers = 1
worker_class = "gthread"
threads = int(os.getenv("GUNICORN_THREADS", "8"))
timeout = 60
graceful_timeout = 20
keepalive = 5
# Render's default GUNICORN_CMD_ARGS includes --preload, which overrides this
# value. That is harmless: background threads start in post_worker_init below.
preload_app = False
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info").lower()


def post_worker_init(worker):
    """Start MQTT ingestion and housekeeping inside the worker process.

    Runs after the worker has loaded the app, with or without --preload.
    Threads must never start in the master: fork() copies only the calling
    thread, so a worker forked while the MQTT thread was connecting inherits
    half-finished imports and locks (on Render this broke the "idna" codec
    and every request returned 500).
    """
    from app.runtime import start_background_services

    start_background_services(worker.wsgi)
