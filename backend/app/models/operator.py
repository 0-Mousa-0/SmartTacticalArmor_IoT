"""OPERATOR — a person who uses the operations-room dashboard."""
from sqlalchemy.orm import validates
from werkzeug.security import check_password_hash, generate_password_hash

from app.extensions import db
from app.models.base_model import TimestampMixin, UTCDateTime, UUIDType, gen_uuid, iso
from app.models.enums import OperatorRole, values
from app.utils.validators import require_email, require_one_of, require_text, validate_password


class Operator(db.Model, TimestampMixin):
    __tablename__ = "operators"

    operator_id = db.Column(UUIDType, primary_key=True, default=gen_uuid)
    full_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(255), nullable=False, unique=True, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(16), nullable=False, default=OperatorRole.OPERATOR.value)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    last_login_at = db.Column(UTCDateTime(), nullable=True)

    @validates("full_name")
    def _validate_full_name(self, _key, value):
        return require_text(value, "full_name", 120)

    @validates("email")
    def _validate_email(self, _key, value):
        return require_email(value)

    @validates("role")
    def _validate_role(self, _key, value):
        return require_one_of(str(value), "role", values(OperatorRole))

    def set_password(self, raw_password: str) -> None:
        self.password_hash = generate_password_hash(validate_password(raw_password))

    def check_password(self, raw_password: str) -> bool:
        return bool(raw_password) and check_password_hash(self.password_hash, raw_password)

    def to_dict(self) -> dict:
        return {
            "operator_id": self.operator_id,
            "full_name": self.full_name,
            "email": self.email,
            "role": self.role,
            "is_active": self.is_active,
            "last_login_at": iso(self.last_login_at),
            "created_at": iso(self.created_at),
        }
