"""ALERT — one incident, with a lifecycle managed by operators.

A vest can send many messages about the same incident (pending -> event,
or active reminders every 30 s); they are folded into one ALERT row and
recorded individually as ALERT_EVENTs (the incident timeline).
"""
from sqlalchemy.orm import validates

from app.extensions import db
from app.models.base_model import JSONType, TimestampMixin, UTCDateTime, UUIDType, gen_uuid, iso
from app.models.enums import OPEN_ALERT_STATUSES, AlertSource, AlertStatus, Severity, values
from app.utils.validators import require_one_of


class Alert(db.Model, TimestampMixin):
    __tablename__ = "alerts"
    __table_args__ = (db.Index("ix_alerts_device_type_status", "device_id", "alert_type", "status"),)

    alert_id = db.Column(UUIDType, primary_key=True, default=gen_uuid)
    device_id = db.Column(UUIDType, db.ForeignKey("devices.device_id", ondelete="CASCADE"), nullable=False, index=True)
    personnel_id = db.Column(UUIDType, db.ForeignKey("personnel.personnel_id", ondelete="SET NULL"), nullable=True)
    alert_type = db.Column(db.String(32), nullable=False)
    source = db.Column(db.String(16), nullable=False, default=AlertSource.DEVICE.value)
    severity = db.Column(db.String(16), nullable=False)
    status = db.Column(db.String(16), nullable=False, index=True)
    priority = db.Column(db.Integer, nullable=False, default=0)
    value = db.Column(db.Float, nullable=True)
    message = db.Column(db.String(255), nullable=True)
    context = db.Column(JSONType, nullable=True)  # snapshot at raise time: tilt, vest_t, hr, lat ...

    occurred_at = db.Column(UTCDateTime(), nullable=False)
    last_event_at = db.Column(UTCDateTime(), nullable=False)
    event_count = db.Column(db.Integer, nullable=False, default=1)

    acknowledged_at = db.Column(UTCDateTime(), nullable=True)
    acknowledged_by = db.Column(UUIDType, db.ForeignKey("operators.operator_id", ondelete="SET NULL"), nullable=True)
    resolved_at = db.Column(UTCDateTime(), nullable=True)
    resolved_by = db.Column(UUIDType, db.ForeignKey("operators.operator_id", ondelete="SET NULL"), nullable=True)
    resolution_note = db.Column(db.String(500), nullable=True)

    device = db.relationship("Device", lazy="joined")
    personnel = db.relationship("Personnel", lazy="joined")
    acknowledger = db.relationship("Operator", foreign_keys=[acknowledged_by], lazy="joined")
    resolver = db.relationship("Operator", foreign_keys=[resolved_by], lazy="joined")
    events = db.relationship(
        "AlertEvent",
        back_populates="alert",
        order_by="AlertEvent.received_at",
        cascade="all, delete-orphan",
        lazy="select",
    )

    @validates("severity")
    def _validate_severity(self, _key, value):
        return require_one_of(str(value), "severity", values(Severity))

    @validates("status")
    def _validate_status(self, _key, value):
        return require_one_of(str(value), "status", values(AlertStatus))

    @validates("source")
    def _validate_source(self, _key, value):
        return require_one_of(str(value), "source", values(AlertSource))

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_ALERT_STATUSES

    def to_dict(self, include_events: bool = False) -> dict:
        data = {
            "alert_id": self.alert_id,
            "alert_type": self.alert_type,
            "source": self.source,
            "severity": self.severity,
            "status": self.status,
            "is_open": self.is_open,
            "priority": self.priority,
            "value": self.value,
            "message": self.message,
            "context": self.context or {},
            "device_id": self.device_id,
            "device_code": self.device.device_code if self.device else None,
            "is_simulated": bool(self.device and self.device.is_simulated),
            "personnel": self.personnel.summary() if self.personnel else None,
            "occurred_at": iso(self.occurred_at),
            "last_event_at": iso(self.last_event_at),
            "event_count": self.event_count,
            "acknowledged_at": iso(self.acknowledged_at),
            "acknowledged_by": self.acknowledger.full_name if self.acknowledger else None,
            "resolved_at": iso(self.resolved_at),
            "resolved_by": self.resolver.full_name if self.resolver else None,
            "resolution_note": self.resolution_note,
        }
        if include_events:
            data["events"] = [event.to_dict() for event in self.events]
        return data
