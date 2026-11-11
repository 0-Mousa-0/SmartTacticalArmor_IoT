"""Shared column types, id helpers and the timestamp mixin.

The types are chosen to behave identically on Postgres (Supabase, prod) and
SQLite (unit tests):

* ``UUIDType``  -> native ``uuid`` on Postgres, CHAR(32) on SQLite, str in Python
* ``JSONType``  -> ``jsonb`` on Postgres, JSON text on SQLite
* ``BigIntPK``  -> ``bigint`` on Postgres, INTEGER on SQLite (needed for autoincrement)
* ``UTCDateTime`` -> ``timestamptz``; always returns timezone-aware UTC datetimes
  (SQLite drops tzinfo, which would otherwise break aware/naive comparisons)
"""
import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, BigInteger, DateTime, Integer, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import TypeDecorator

from app.extensions import db


def utcnow() -> datetime:
    return datetime.now(UTC)


def gen_uuid() -> str:
    return str(uuid.uuid4())


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


class UTCDateTime(TypeDecorator):
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


UUIDType = Uuid(as_uuid=False)
JSONType = JSON().with_variant(JSONB(), "postgresql")
BigIntPK = BigInteger().with_variant(Integer(), "sqlite")


class TimestampMixin:
    created_at = db.Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = db.Column(UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False)
