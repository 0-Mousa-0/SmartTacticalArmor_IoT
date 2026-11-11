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
preload_app = False  # background threads must start inside the worker, not the master
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info").lower()
