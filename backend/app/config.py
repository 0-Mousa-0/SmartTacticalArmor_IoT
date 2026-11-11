"""Configuration objects for the Smart Tactical Armor (STA) API.

Every secret and deployment-specific value is read from environment
variables (see .env.example). Nothing sensitive is hard-coded here.
"""
import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv
from sqlalchemy.pool import NullPool

# Loaded here (not only in run.py) so pytest, gunicorn and `flask` CLI
# commands all see the same .env. interpolate=False keeps literal '$'.
load_dotenv(interpolate=False)


# ── env helpers ──────────────────────────────────────────────
def _str(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        return int(raw) if raw and raw.strip() else default
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    raw = os.getenv(name)
    try:
        return float(raw) if raw and raw.strip() else default
    except ValueError:
        return default


def _list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def normalize_database_url(url: str) -> str:
    """Make a Supabase / Heroku style URL usable by SQLAlchemy + psycopg2.

    * ``postgres://`` and ``postgresql://`` become ``postgresql+psycopg2://``
    * ``sslmode=require`` is appended for remote hosts, because Supabase
      expects TLS and most drivers silently default to ``prefer``.
    """
    url = (url or "").strip()
    if not url:
        return url
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            url = "postgresql+psycopg2://" + url[len(prefix):]
            break
    if url.startswith("postgresql"):
        parts = urlsplit(url)
        query = dict(parse_qsl(parts.query))
        if "sslmode" not in query and (parts.hostname or "") not in {"localhost", "127.0.0.1"}:
            query["sslmode"] = "require"
            url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
    return url


def _engine_options(uri: str) -> dict:
    """Connection-pool settings tuned for the Supabase session pooler.

    Render may reset long-lived outbound connections, so every checkout is
    pinged and connections are recycled well before typical idle cut-offs.
    """
    if not uri.startswith("postgresql"):
        return {}
    return {
        "pool_pre_ping": True,
        "pool_recycle": 280,
        "pool_size": _int("DB_POOL_SIZE", 5),
        "max_overflow": _int("DB_MAX_OVERFLOW", 5),
        "connect_args": {
            "connect_timeout": 10,
            "application_name": "sta-api",
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 5,
        },
    }


class Config:
    # ── Flask / API ──────────────────────────────────────────
    APP_NAME = "Smart Tactical Armor API"
    API_VERSION = "1.0.0"
    SECRET_KEY = _str("SECRET_KEY", "dev-only-insecure-secret-key-change-me-0123456789")
    RESTX_ERROR_404_HELP = False
    RESTX_MASK_SWAGGER = False
    JSON_AS_ASCII = False
    MAX_CONTENT_LENGTH = 1 * 1024 * 1024  # the API only accepts small JSON bodies

    # ── CORS (comma-separated origins; "*" when unset) ───────
    CORS_ORIGINS = _list("CORS_ORIGINS", "*")

    # ── Database (Supabase Postgres via the session pooler) ──
    SQLALCHEMY_DATABASE_URI = normalize_database_url(_str("DATABASE_URL")) or "sqlite:///sta_dev.db"
    SQLALCHEMY_ENGINE_OPTIONS = _engine_options(SQLALCHEMY_DATABASE_URI)
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # ── Operator sessions (JWT) ──────────────────────────────
    JWT_EXPIRES_MINUTES = _int("JWT_EXPIRES_MINUTES", 8 * 60)  # one shift
    LOGIN_MAX_ATTEMPTS = _int("LOGIN_MAX_ATTEMPTS", 5)
    LOGIN_LOCKOUT_SECONDS = _int("LOGIN_LOCKOUT_SECONDS", 300)
    # Optional first-admin bootstrap (Render's free plan has no shell).
    BOOTSTRAP_ADMIN_EMAIL = _str("BOOTSTRAP_ADMIN_EMAIL")
    BOOTSTRAP_ADMIN_PASSWORD = _str("BOOTSTRAP_ADMIN_PASSWORD")
    BOOTSTRAP_ADMIN_NAME = _str("BOOTSTRAP_ADMIN_NAME", "System Administrator")

    # ── MQTT (EMQX Cloud Serverless or any MQTT 3.1.1 broker) ─
    MQTT_ENABLED = _bool("MQTT_ENABLED", False)
    MQTT_HOST = _str("MQTT_HOST")
    MQTT_PORT = _int("MQTT_PORT", 8883)
    MQTT_TLS = _bool("MQTT_TLS", True)
    MQTT_CA_CERTS = _str("MQTT_CA_CERTS")  # empty -> certifi bundle
    MQTT_USERNAME = _str("MQTT_USERNAME")
    MQTT_PASSWORD = _str("MQTT_PASSWORD")
    MQTT_CLIENT_ID = _str("MQTT_CLIENT_ID", "sta-backend")
    # Persistent session: QoS-1 alerts are queued by the broker while the
    # API sleeps (Render free plan) and delivered when it wakes up.
    MQTT_CLEAN_SESSION = _bool("MQTT_CLEAN_SESSION", False)
    MQTT_KEEPALIVE_S = _int("MQTT_KEEPALIVE_S", 30)
    MQTT_TOPIC_ROOT = _str("MQTT_TOPIC_ROOT", "sta/v1")

    # ── Devices & ingestion ──────────────────────────────────
    DEVICE_AUTO_REGISTER = _bool("DEVICE_AUTO_REGISTER", False)
    DEVICE_DEFAULT_INTERVAL_S = 5
    DEVICE_OFFLINE_MIN_S = _int("DEVICE_OFFLINE_MIN_S", 20)  # offline after max(this, 3 x interval)
    CONTACT_LOST_ALERTS = _bool("CONTACT_LOST_ALERTS", True)
    CONTACT_LOST_AFTER_S = _int("CONTACT_LOST_AFTER_S", 60)
    CONTACT_LOST_LOOKBACK_H = _int("CONTACT_LOST_LOOKBACK_H", 12)
    TELEMETRY_STORE_MIN_INTERVAL_S = _int("TELEMETRY_STORE_MIN_INTERVAL_S", 5)
    TELEMETRY_RETENTION_DAYS = _int("TELEMETRY_RETENTION_DAYS", 7)
    COMMAND_TIMEOUT_S = _int("COMMAND_TIMEOUT_S", 30)
    HOUSEKEEPING_INTERVAL_S = _int("HOUSEKEEPING_INTERVAL_S", 15)

    # ── AI analysis (explainable anomaly detection) ──────────
    ANALYSIS_Z_THRESHOLD = _float("ANALYSIS_Z_THRESHOLD", 3.0)
    ANALYSIS_WARMUP_SAMPLES = _int("ANALYSIS_WARMUP_SAMPLES", 30)
    ANALYSIS_EWMA_ALPHA = _float("ANALYSIS_EWMA_ALPHA", 0.05)
    ANALYSIS_PERSIST_READINGS = _int("ANALYSIS_PERSIST_READINGS", 3)


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False


class TestingConfig(Config):
    TESTING = True
    SECRET_KEY = "test-secret-key-that-is-long-enough-for-hs256-signing"
    # In-memory SQLite by default; set TEST_DATABASE_URL to run the same
    # suite against a disposable Postgres (CI / pre-deploy verification).
    SQLALCHEMY_DATABASE_URI = normalize_database_url(_str("TEST_DATABASE_URL")) or "sqlite://"
    # NullPool: every test builds a fresh app/engine; pooled connections from
    # earlier tests must not pile up on the test database server.
    SQLALCHEMY_ENGINE_OPTIONS: dict = (
        {"poolclass": NullPool} if SQLALCHEMY_DATABASE_URI.startswith("postgresql") else {}
    )
    MQTT_ENABLED = False
    BOOTSTRAP_ADMIN_EMAIL = ""
    BOOTSTRAP_ADMIN_PASSWORD = ""
    ANALYSIS_WARMUP_SAMPLES = 10


config_by_name = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
}


def get_config():
    return config_by_name.get(_str("FLASK_ENV", "development"), DevelopmentConfig)
