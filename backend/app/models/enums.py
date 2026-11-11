"""Domain enumerations shared by models, services and the API.

Stored in the database as their lowercase ``value`` (plain VARCHAR columns
validated in Python), which keeps migrations portable between SQLite in
tests and Postgres in production.
"""
from enum import StrEnum


class OperatorRole(StrEnum):
    ADMIN = "admin"        # manages fleet, personnel and operator accounts
    OPERATOR = "operator"  # acknowledges alerts, sends commands to vests
    VIEWER = "viewer"      # read-only (e.g. judges, supervisors)


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"

    @property
    def rank(self) -> int:
        return {"info": 1, "warning": 2, "critical": 3}[self.value]

    @classmethod
    def from_device_code(cls, code) -> "Severity":
        """Firmware sends severity as an int: 1 info, 2 warning, 3 critical."""
        try:
            number = int(code)
        except (TypeError, ValueError):
            return cls.INFO
        return {3: cls.CRITICAL, 2: cls.WARNING}.get(number, cls.INFO)


class AlertStatus(StrEnum):
    PENDING = "pending"            # vest pre-alert: wearer can still cancel
    OPEN = "open"                  # needs an operator
    ACKNOWLEDGED = "acknowledged"  # operator has seen it, help is coming
    RESOLVED = "resolved"          # closed by an operator
    CLEARED = "cleared"            # condition ended on its own (device / analysis)
    CANCELLED = "cancelled"        # wearer pressed "I'm OK"


OPEN_ALERT_STATUSES = (AlertStatus.PENDING, AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED)
CLOSED_ALERT_STATUSES = (AlertStatus.RESOLVED, AlertStatus.CLEARED, AlertStatus.CANCELLED)


class AlertSource(StrEnum):
    DEVICE = "device"      # raised by the vest firmware
    ANALYSIS = "analysis"  # raised by the server-side AI analysis


class DeviceAlertState(StrEnum):
    """The ``state`` field the firmware puts in every alert message."""
    PENDING = "pending"
    EVENT = "event"
    ACTIVE = "active"
    CLEARED = "cleared"
    CANCELLED = "cancelled"


class CommandType(StrEnum):
    PING = "ping"
    ACK = "ack"
    EVAC = "evac"
    STOP = "stop"
    INTERVAL = "interval"
    SILENT = "silent"
    CALIBRATE = "calibrate"
    STATUS = "status"


class CommandStatus(StrEnum):
    QUEUED = "queued"
    SENT = "sent"
    ACKNOWLEDGED = "acknowledged"
    FAILED = "failed"
    TIMEOUT = "timeout"


class RiskLevel(StrEnum):
    NORMAL = "normal"
    ELEVATED = "elevated"
    HIGH = "high"
    CRITICAL = "critical"


class Posture(StrEnum):
    UPRIGHT = "upright"
    BENT = "bent"
    LYING = "lying"
    UNKNOWN = "unknown"


def values(enum_cls) -> tuple[str, ...]:
    return tuple(member.value for member in enum_cls)
