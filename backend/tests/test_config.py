"""Configuration safety: URL normalisation and production fail-fast checks."""
import pytest

from app import create_app
from app.config import ProductionConfig, normalize_database_url


def test_supabase_url_gets_driver_and_tls():
    url = normalize_database_url("postgresql://postgres.abc:p%40ss@aws-0-eu-central-1.pooler.supabase.com:5432/postgres")
    assert url.startswith("postgresql+psycopg2://postgres.abc:p%40ss@")
    assert url.endswith("sslmode=require")


def test_heroku_style_scheme_and_explicit_sslmode_kept():
    url = normalize_database_url("postgres://u:p@db.example.com:5432/x?sslmode=verify-full")
    assert url == "postgresql+psycopg2://u:p@db.example.com:5432/x?sslmode=verify-full"


def test_local_postgres_does_not_force_tls():
    assert "sslmode" not in normalize_database_url("postgresql://postgres@localhost:5432/sta")


def test_production_refuses_sqlite_fallback():
    class Unconfigured(ProductionConfig):
        SQLALCHEMY_DATABASE_URI = "sqlite:///sta_dev.db"
        SECRET_KEY = "a-real-secret-key-for-this-test-only-0123456789"

    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        create_app(Unconfigured)


def test_production_refuses_development_secret():
    class NoSecret(ProductionConfig):
        SQLALCHEMY_DATABASE_URI = "postgresql+psycopg2://u:p@localhost:5432/x"
        SECRET_KEY = "dev-only-insecure-secret-key-change-me-0123456789"

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_app(NoSecret)
