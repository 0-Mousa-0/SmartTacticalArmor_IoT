"""Model registry.

Importing every model here guarantees SQLAlchemy knows all tables before
``db.create_all()`` (tests) or Alembic autogenerate (migrations) runs.
"""
from app.models.alert import Alert  # noqa: F401
from app.models.alert_event import AlertEvent  # noqa: F401
from app.models.command import Command  # noqa: F401
from app.models.device import Device  # noqa: F401
from app.models.metric_baseline import MetricBaseline  # noqa: F401
from app.models.operator import Operator  # noqa: F401
from app.models.personnel import Personnel  # noqa: F401
from app.models.telemetry_reading import TelemetryReading  # noqa: F401

__all__ = [
    "Operator",
    "Personnel",
    "Device",
    "TelemetryReading",
    "Alert",
    "AlertEvent",
    "Command",
    "MetricBaseline",
]
