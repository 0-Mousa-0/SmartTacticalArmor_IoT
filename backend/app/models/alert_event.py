"""ALERT_EVENT — one entry in an incident's timeline.

Device-originated events carry the vest's (seq, uptime) pair; the unique
constraint makes ingestion idempotent, because MQTT QoS 1 is
"at least once" and the vest re-sends queued alerts after reconnecting.
"""
from app.extensions import db
from app.models.base_model import BigIntPK, JSONType, UTCDateTime, UUIDType, iso, utcnow


class AlertEvent(db.Model):
    __tablename__ = "alert_events"
    __table_args__ = (
        db.UniqueConstraint("device_id", "device_seq", "device_uptime_s", name="uq_alert_events_device_message"),
    )

    event_id = db.Column(BigIntPK, primary_key=True, autoincrement=True)
    alert_id = db.Column(UUIDType, db.ForeignKey("alerts.alert_id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = db.Column(UUIDType, db.ForeignKey("devices.device_id", ondelete="CASCADE"), nullable=False)
    # pending | event | active | cleared | cancelled | acknowledged | resolved | escalated | reopened | detected
    kind = db.Column(db.String(16), nullable=False)
    severity = db.Column(db.String(16), nullable=True)
    value = db.Column(db.Float, nullable=True)
    device_seq = db.Column(db.Integer, nullable=True)
    device_uptime_s = db.Column(db.Integer, nullable=True)
    actor_operator_id = db.Column(
        UUIDType, db.ForeignKey("operators.operator_id", ondelete="SET NULL"), nullable=True
    )
    note = db.Column(db.String(500), nullable=True)
    payload = db.Column(JSONType, nullable=True)
    received_at = db.Column(UTCDateTime(), nullable=False, default=utcnow)

    alert = db.relationship("Alert", back_populates="events")
    actor = db.relationship("Operator", lazy="joined")

    def to_dict(self) -> dict:
        return {
            "event_id": self.event_id,
            "kind": self.kind,
            "severity": self.severity,
            "value": self.value,
            "device_seq": self.device_seq,
            "actor": self.actor.full_name if self.actor else None,
            "note": self.note,
            "received_at": iso(self.received_at),
        }
