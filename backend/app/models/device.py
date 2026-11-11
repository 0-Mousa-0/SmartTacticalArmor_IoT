"""DEVICE — one smart vest (Arduino UNO R4 WiFi controller).

Besides its identity, the row caches the vest's latest state (status
report, last telemetry snapshot, AI risk assessment) so live dashboard
reads are a single cheap query instead of scanning telemetry history.
"""
from sqlalchemy.orm import validates

from app.extensions import db
from app.models.base_model import JSONType, TimestampMixin, UTCDateTime, UUIDType, gen_uuid, iso
from app.models.enums import RiskLevel, values
from app.utils.validators import optional_text, require_device_code, require_one_of, require_text


class Device(db.Model, TimestampMixin):
    __tablename__ = "devices"

    device_id = db.Column(UUIDType, primary_key=True, default=gen_uuid)
    device_code = db.Column(db.String(32), nullable=False, unique=True, index=True)  # = MQTT id
    display_name = db.Column(db.String(80), nullable=False)
    personnel_id = db.Column(
        UUIDType, db.ForeignKey("personnel.personnel_id", ondelete="SET NULL"), nullable=True, unique=True
    )
    is_simulated = db.Column(db.Boolean, nullable=False, default=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    notes = db.Column(db.String(255), nullable=True)

    # ── reported by the vest on sta/v1/<id>/status ──
    firmware_version = db.Column(db.String(20), nullable=True)
    ip_address = db.Column(db.String(45), nullable=True)
    rssi = db.Column(db.Integer, nullable=True)
    sensors = db.Column(JSONType, nullable=True)
    telemetry_interval_s = db.Column(db.Integer, nullable=False, default=5)
    buzzer_enabled = db.Column(db.Boolean, nullable=True)
    reported_online = db.Column(db.Boolean, nullable=False, default=False)
    last_status_at = db.Column(UTCDateTime(), nullable=True)

    # ── live state cache ──
    last_seen_at = db.Column(UTCDateTime(), nullable=True, index=True)
    boot_at = db.Column(UTCDateTime(), nullable=True)  # estimated: received_at - uptime
    last_telemetry = db.Column(JSONType, nullable=True)
    last_telemetry_at = db.Column(UTCDateTime(), nullable=True)
    last_stored_at = db.Column(UTCDateTime(), nullable=True)

    # ── AI analysis output ──
    risk_score = db.Column(db.Integer, nullable=False, default=0)
    risk_level = db.Column(db.String(16), nullable=False, default=RiskLevel.NORMAL.value)
    risk_reasons = db.Column(JSONType, nullable=True)
    risk_updated_at = db.Column(UTCDateTime(), nullable=True)

    personnel = db.relationship("Personnel", back_populates="device", lazy="joined")

    @validates("device_code")
    def _validate_code(self, _key, value):
        return require_device_code(value)

    @validates("display_name")
    def _validate_name(self, _key, value):
        return require_text(value, "display_name", 80)

    @validates("notes")
    def _validate_notes(self, _key, value):
        return optional_text(value, "notes", 255)

    @validates("risk_level")
    def _validate_risk_level(self, _key, value):
        return require_one_of(str(value), "risk_level", values(RiskLevel))

    @validates("telemetry_interval_s")
    def _validate_interval(self, _key, value):
        number = int(value)
        if not 1 <= number <= 3600:
            raise ValueError("telemetry_interval_s must be between 1 and 3600")
        return number

    def to_dict(self) -> dict:
        return {
            "device_id": self.device_id,
            "device_code": self.device_code,
            "display_name": self.display_name,
            "is_simulated": self.is_simulated,
            "is_active": self.is_active,
            "notes": self.notes,
            "personnel": self.personnel.summary() if self.personnel else None,
            "firmware_version": self.firmware_version,
            "ip_address": self.ip_address,
            "rssi": self.rssi,
            "sensors": self.sensors or {},
            "telemetry_interval_s": self.telemetry_interval_s,
            "buzzer_enabled": self.buzzer_enabled,
            "reported_online": self.reported_online,
            "last_status_at": iso(self.last_status_at),
            "last_seen_at": iso(self.last_seen_at),
            "boot_at": iso(self.boot_at),
            "created_at": iso(self.created_at),
        }
