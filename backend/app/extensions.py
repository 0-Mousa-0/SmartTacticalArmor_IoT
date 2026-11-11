"""Shared extension singletons, initialised in the app factory.

Kept apart from ``app/__init__.py`` so models, repositories and services can
import ``db`` without creating circular imports with the application object.
"""
from flask_cors import CORS
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import JSON, MetaData

# Deterministic constraint names keep Alembic migrations stable across
# SQLite (tests) and Postgres (Supabase).
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

db = SQLAlchemy(metadata=MetaData(naming_convention=NAMING_CONVENTION))
migrate = Migrate()
cors = CORS()


def render_migration_item(type_, obj, autogen_context):
    """Alembic hook: write our portable custom types as plain SQLAlchemy
    types, so generated migrations import nothing from the app package."""
    from app.models.base_model import UTCDateTime  # local import: avoids a cycle

    if type_ != "type":
        return False
    if isinstance(obj, UTCDateTime):
        return "sa.DateTime(timezone=True)"
    if isinstance(obj, JSON) and "postgresql" in (getattr(obj, "_variant_mapping", None) or {}):
        autogen_context.imports.add("from sqlalchemy.dialects import postgresql")
        return "sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql')"
    return False
