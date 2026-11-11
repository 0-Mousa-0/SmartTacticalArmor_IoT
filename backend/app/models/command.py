"""COMMAND — an instruction sent from the operations room to a vest.

``correlation_id`` (``cid`` on the wire) is echoed back by the firmware in
its response, which is how a response is matched to the command.
"""
from sqlalchemy.orm import validates

from app.extensions import db
from app.models.base_model import JSONType, TimestampMixin, UTCDateTime, UUIDType, gen_uuid, iso
from app.models.enums import CommandStatus, CommandType, values
from app.utils.validators import require_one_of


class Command(db.Model, TimestampMixin):
    __tablename__ = "commands"

    command_id = db.Column(UUIDType, primary_key=True, default=gen_uuid)
    device_id = db.Column(UUIDType, db.ForeignKey("devices.device_id", ondelete="CASCADE"), nullable=False, index=True)
    issued_by = db.Column(UUIDType, db.ForeignKey("operators.operator_id", ondelete="SET NULL"), nullable=True)
    alert_id = db.Column(UUIDType, db.ForeignKey("alerts.alert_id", ondelete="SET NULL"), nullable=True)
    command_type = db.Column(db.String(16), nullable=False)
    params = db.Column(JSONType, nullable=True)
    correlation_id = db.Column(db.String(16), nullable=False, unique=True, index=True)
    status = db.Column(db.String(16), nullable=False, default=CommandStatus.QUEUED.value, index=True)
    response_ok = db.Column(db.Boolean, nullable=True)
    response_info = db.Column(db.String(255), nullable=True)
    issued_at = db.Column(UTCDateTime(), nullable=False)
    sent_at = db.Column(UTCDateTime(), nullable=True)
    completed_at = db.Column(UTCDateTime(), nullable=True)

    issuer = db.relationship("Operator", lazy="joined")
    device = db.relationship("Device", lazy="joined")

    @validates("command_type")
    def _validate_type(self, _key, value):
        return require_one_of(str(value), "command_type", values(CommandType))

    @validates("status")
    def _validate_status(self, _key, value):
        return require_one_of(str(value), "status", values(CommandStatus))

    def to_dict(self) -> dict:
        return {
            "command_id": self.command_id,
            "device_id": self.device_id,
            "device_code": self.device.device_code if self.device else None,
            "command_type": self.command_type,
            "params": self.params or {},
            "correlation_id": self.correlation_id,
            "status": self.status,
            "response_ok": self.response_ok,
            "response_info": self.response_info,
            "issued_by": self.issuer.full_name if self.issuer else None,
            "alert_id": self.alert_id,
            "issued_at": iso(self.issued_at),
            "sent_at": iso(self.sent_at),
            "completed_at": iso(self.completed_at),
        }
