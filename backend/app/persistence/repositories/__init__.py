"""Repository registry — one repository per aggregate.

Repositories only build queries and stage changes on the session; they
never commit. The facade owns the transaction (unit of work), so one use
case = one atomic commit.
"""
from app.persistence.repositories.alert_repository import AlertFilter, AlertRepository
from app.persistence.repositories.baseline_repository import BaselineRepository
from app.persistence.repositories.command_repository import CommandRepository
from app.persistence.repositories.device_repository import DeviceRepository
from app.persistence.repositories.operator_repository import OperatorRepository
from app.persistence.repositories.personnel_repository import PersonnelRepository
from app.persistence.repositories.telemetry_repository import TelemetryRepository

__all__ = [
    "AlertFilter",
    "AlertRepository",
    "BaselineRepository",
    "CommandRepository",
    "DeviceRepository",
    "OperatorRepository",
    "PersonnelRepository",
    "TelemetryRepository",
]
