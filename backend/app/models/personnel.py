"""PERSONNEL — a field member who wears a smart vest."""
from sqlalchemy.orm import validates

from app.extensions import db
from app.models.base_model import TimestampMixin, UUIDType, gen_uuid, iso
from app.utils.validators import optional_coordinate, optional_text, require_callsign, require_text


class Personnel(db.Model, TimestampMixin):
    __tablename__ = "personnel"

    personnel_id = db.Column(UUIDType, primary_key=True, default=gen_uuid)
    callsign = db.Column(db.String(32), nullable=False, unique=True, index=True)
    full_name = db.Column(db.String(120), nullable=False)
    rank = db.Column(db.String(40), nullable=True)
    unit_name = db.Column(db.String(80), nullable=True)
    blood_type = db.Column(db.String(4), nullable=True)
    zone = db.Column(db.String(80), nullable=True)
    # Assigned post: shown on the map until the vest has a GPS fix (Phase 3).
    post_lat = db.Column(db.Float, nullable=True)
    post_lng = db.Column(db.Float, nullable=True)
    notes = db.Column(db.String(255), nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    device = db.relationship("Device", back_populates="personnel", uselist=False)

    @validates("callsign")
    def _validate_callsign(self, _key, value):
        return require_callsign(value)

    @validates("full_name")
    def _validate_full_name(self, _key, value):
        return require_text(value, "full_name", 120)

    @validates("rank", "unit_name", "zone", "notes")
    def _validate_optional_text(self, key, value):
        return optional_text(value, key, 255 if key == "notes" else 80)

    @validates("blood_type")
    def _validate_blood_type(self, _key, value):
        cleaned = optional_text(value, "blood_type", 4)
        allowed = {"A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"}
        if cleaned and cleaned.upper() not in allowed:
            raise ValueError("blood_type must be one of: " + ", ".join(sorted(allowed)))
        return cleaned.upper() if cleaned else None

    @validates("post_lat")
    def _validate_lat(self, _key, value):
        return optional_coordinate(value, "post_lat", 90)

    @validates("post_lng")
    def _validate_lng(self, _key, value):
        return optional_coordinate(value, "post_lng", 180)

    def summary(self) -> dict:
        return {
            "personnel_id": self.personnel_id,
            "callsign": self.callsign,
            "full_name": self.full_name,
            "rank": self.rank,
        }

    def to_dict(self) -> dict:
        return {
            **self.summary(),
            "unit_name": self.unit_name,
            "blood_type": self.blood_type,
            "zone": self.zone,
            "post_lat": self.post_lat,
            "post_lng": self.post_lng,
            "notes": self.notes,
            "is_active": self.is_active,
            "device_id": self.device.device_id if self.device else None,
            "device_code": self.device.device_code if self.device else None,
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
        }
