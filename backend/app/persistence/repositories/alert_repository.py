"""Data access for ALERT and ALERT_EVENT."""
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func

from app.extensions import db
from app.models.alert import Alert
from app.models.alert_event import AlertEvent
from app.models.enums import CLOSED_ALERT_STATUSES, OPEN_ALERT_STATUSES


@dataclass(frozen=True)
class AlertFilter:
    scope: str = "open"            # open | closed | all
    severity: str | None = None
    alert_type: str | None = None
    source: str | None = None
    device_id: str | None = None
    since: datetime | None = None
    limit: int = 50
    offset: int = 0


class AlertRepository:
    def add(self, alert: Alert) -> Alert:
        db.session.add(alert)
        db.session.flush()
        return alert

    def add_event(self, event: AlertEvent) -> AlertEvent:
        db.session.add(event)
        return event

    def get(self, alert_id: str) -> Alert | None:
        return db.session.get(Alert, alert_id)

    def find_open(self, device_id: str, alert_type: str) -> Alert | None:
        return (
            db.session.query(Alert)
            .filter(
                Alert.device_id == device_id,
                Alert.alert_type == alert_type,
                Alert.status.in_([s.value for s in OPEN_ALERT_STATUSES]),
            )
            .order_by(Alert.occurred_at.desc())
            .first()
        )

    def open_for_device(self, device_id: str) -> list[Alert]:
        return (
            db.session.query(Alert)
            .filter(Alert.device_id == device_id, Alert.status.in_([s.value for s in OPEN_ALERT_STATUSES]))
            .all()
        )

    def all_open(self) -> list[Alert]:
        return db.session.query(Alert).filter(Alert.status.in_([s.value for s in OPEN_ALERT_STATUSES])).all()

    def device_event_exists(self, device_id: str, seq: int | None, uptime_s: int | None) -> bool:
        if seq is None or uptime_s is None:
            return False
        return (
            db.session.query(AlertEvent.event_id)
            .filter_by(device_id=device_id, device_seq=seq, device_uptime_s=uptime_s)
            .first()
            is not None
        )

    def _filtered(self, flt: AlertFilter):
        query = db.session.query(Alert)
        if flt.scope == "open":
            query = query.filter(Alert.status.in_([s.value for s in OPEN_ALERT_STATUSES]))
        elif flt.scope == "closed":
            query = query.filter(Alert.status.in_([s.value for s in CLOSED_ALERT_STATUSES]))
        if flt.severity:
            query = query.filter(Alert.severity == flt.severity)
        if flt.alert_type:
            query = query.filter(Alert.alert_type == flt.alert_type)
        if flt.source:
            query = query.filter(Alert.source == flt.source)
        if flt.device_id:
            query = query.filter(Alert.device_id == flt.device_id)
        if flt.since:
            query = query.filter(Alert.last_event_at >= flt.since)
        return query

    def search(self, flt: AlertFilter) -> tuple[list[Alert], int]:
        query = self._filtered(flt)
        total = query.count()
        # Open incidents: most urgent first. History: most recent first.
        if flt.scope == "open":
            query = query.order_by(Alert.priority.desc(), Alert.last_event_at.desc())
        else:
            query = query.order_by(Alert.last_event_at.desc())
        return query.offset(flt.offset).limit(flt.limit).all(), total

    def count_open_by_severity(self) -> dict[str, int]:
        rows = (
            db.session.query(Alert.severity, func.count(Alert.alert_id))
            .filter(Alert.status.in_([s.value for s in OPEN_ALERT_STATUSES]))
            .group_by(Alert.severity)
            .all()
        )
        return {severity: count for severity, count in rows}

    def recent_analysis(self, limit: int = 20) -> list[Alert]:
        return (
            db.session.query(Alert)
            .filter(Alert.source == "analysis")
            .order_by(Alert.last_event_at.desc())
            .limit(limit)
            .all()
        )
