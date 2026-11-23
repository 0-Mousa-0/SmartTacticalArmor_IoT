"""Application factory.

Builds the Flask app, initialises extensions, creates the facade (business
layer) and mounts the flask-restx Api, which serves Swagger UI at
/api/v1/docs. Background services (MQTT gateway, housekeeping) are started
separately by ``app.runtime`` so tests, migrations and CLI commands stay
side-effect free.
"""
from pathlib import Path

from flask import Flask
from flask_restx import Api
from werkzeug.middleware.proxy_fix import ProxyFix

from app.config import get_config
from app.extensions import cors, db, migrate, render_migration_item

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
PUBLIC_ACCESS_ROLES = ("viewer", "operator", "admin")


def _check_access_settings(app: Flask) -> None:
    """A typo must not silently change who can use the API."""
    role = app.config.get("PUBLIC_ACCESS_ROLE") or ""
    if role and role not in PUBLIC_ACCESS_ROLES:
        raise RuntimeError(
            f"PUBLIC_ACCESS_ROLE={role!r} is not valid: use viewer, operator, admin, or leave it empty"
        )


def _check_production_settings(app: Flask) -> None:
    """Fail fast instead of silently running production on unsafe defaults."""
    if app.config.get("TESTING") or app.config.get("DEBUG"):
        return
    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite"):
        raise RuntimeError("DATABASE_URL is not set: refusing to run production on a throwaway SQLite file")
    if app.config["SECRET_KEY"].startswith("dev-only"):
        raise RuntimeError("SECRET_KEY is not set: refusing to sign production sessions with the development key")


def create_app(config_object=None) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object or get_config())
    _check_access_settings(app)
    _check_production_settings(app)
    app.url_map.strict_slashes = False
    # Render terminates TLS in front of the app: trust one proxy hop for the
    # client IP / scheme (login rate limiting, absolute URLs in Swagger).
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    # ── extensions ───────────────────────────────────────────
    db.init_app(app)
    migrate.init_app(app, db, directory=str(MIGRATIONS_DIR), compare_type=True,
                     render_item=render_migration_item)
    cors.init_app(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})

    from app import models  # noqa: F401 — register every table with SQLAlchemy
    from app.services.facade import EXTENSION_KEY, StaFacade

    app.extensions[EXTENSION_KEY] = StaFacade(app.config)

    # ── REST API + Swagger ───────────────────────────────────
    api = Api(
        app,
        version=app.config["API_VERSION"],
        title="Smart Tactical Armor — Command & Control API",
        description="Operations-room backend: vest telemetry, AI analysis, alerts and commands.",
        doc="/api/v1/docs",
        prefix="/api/v1",
        authorizations={
            "Bearer": {
                "type": "apiKey",
                "in": "header",
                "name": "Authorization",
                "description": "Session token from /auth/login. Format: **Bearer &lt;token&gt;**",
            }
        },
        security="Bearer",
    )

    from app.api.v1.alerts import ns as alerts_ns
    from app.api.v1.auth import ns as auth_ns
    from app.api.v1.dashboard import analysis_ns, armor_ns, health_ns, overview_ns
    from app.api.v1.devices import ns as devices_ns
    from app.api.v1.operators import ns as operators_ns
    from app.api.v1.personnel import ns as personnel_ns

    api.add_namespace(health_ns, path="/health")
    api.add_namespace(auth_ns, path="/auth")
    api.add_namespace(overview_ns, path="/overview")
    api.add_namespace(devices_ns, path="/devices")
    api.add_namespace(alerts_ns, path="/alerts")
    api.add_namespace(analysis_ns, path="/analysis")
    api.add_namespace(armor_ns, path="/armor")
    api.add_namespace(personnel_ns, path="/personnel")
    api.add_namespace(operators_ns, path="/operators")

    @api.errorhandler(ValueError)
    def _handle_value_error(error):
        # Model @validates hooks raise ValueError with a client-safe message.
        return {"message": str(error)}, 400

    @app.get("/")
    def index():
        return {
            "name": app.config["APP_NAME"],
            "version": app.config["API_VERSION"],
            "docs": "/api/v1/docs",
            "health": "/api/v1/health",
        }

    from app.cli import register_cli

    register_cli(app)
    return app
