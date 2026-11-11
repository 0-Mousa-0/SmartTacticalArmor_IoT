"""enable row level security on every table (Supabase hardening)

Supabase publishes the `public` schema through its auto-generated Data API
(PostgREST) for the anon / authenticated roles. This system never uses that
API: the Flask backend connects directly as the table owner, and owners
bypass RLS. Enabling RLS with no policies therefore closes that side door
without affecting the application. No-op on other databases (SQLite tests).

Revision ID: 0002_enable_rls
Revises: 0001_initial
Create Date: 2026-11-11
"""
from alembic import op

revision = "0002_enable_rls"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

TABLES = (
    "operators",
    "personnel",
    "devices",
    "telemetry_readings",
    "alerts",
    "alert_events",
    "commands",
    "metric_baselines",
    "alembic_version",
)


def upgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')


def downgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f'ALTER TABLE public."{table}" DISABLE ROW LEVEL SECURITY')
