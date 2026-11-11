"""AI analysis — alert prioritisation ("prioritized alerts").

Ranks open incidents so the most dangerous, least-handled one is always at
the top of the operator's queue:

    priority = base(type) x severity weight x status weight + age boost

* base(type)   — from the alert catalog (SOS 100 ... GPS_LOST 25)
* severity     — critical 1.0, warning 0.7, info 0.45
* status       — open 1.0, pending 0.9, acknowledged 0.6, closed 0.2
* age boost    — unacknowledged incidents climb up to +10 over 5 minutes
"""
from app.models.alert_catalog import ALERT_CATALOG

_SEVERITY = {"critical": 1.0, "warning": 0.7, "info": 0.45}
_STATUS = {"open": 1.0, "pending": 0.9, "acknowledged": 0.6}


def compute_priority(alert_type: str, severity: str, status: str, age_s: float = 0.0) -> int:
    info = ALERT_CATALOG.get(alert_type)
    base = info.base_priority if info else 40
    score = base * _SEVERITY.get(severity, 0.45) * _STATUS.get(status, 0.2)
    if status in ("open", "pending"):
        score += min(10.0, max(0.0, age_s) / 30.0)
    return int(max(0, min(100, round(score))))
