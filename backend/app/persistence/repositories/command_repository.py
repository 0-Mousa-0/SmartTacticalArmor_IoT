"""Data access for COMMAND."""
from datetime import datetime

from app.extensions import db
from app.models.command import Command
from app.models.enums import CommandStatus


class CommandRepository:
    def add(self, command: Command) -> Command:
        db.session.add(command)
        db.session.flush()
        return command

    def get(self, command_id: str) -> Command | None:
        return db.session.get(Command, command_id)

    def get_by_correlation(self, correlation_id: str) -> Command | None:
        return db.session.query(Command).filter(Command.correlation_id == correlation_id).first()

    def latest_sent_of_type(self, device_id: str, command_type: str) -> Command | None:
        """Fallback match for firmware that does not echo ``cid``."""
        return (
            db.session.query(Command)
            .filter_by(device_id=device_id, command_type=command_type, status=CommandStatus.SENT.value)
            .order_by(Command.issued_at.desc())
            .first()
        )

    def list_for_device(self, device_id: str, limit: int = 20) -> list[Command]:
        return (
            db.session.query(Command)
            .filter(Command.device_id == device_id)
            .order_by(Command.issued_at.desc())
            .limit(limit)
            .all()
        )

    def stale_sent(self, cutoff: datetime) -> list[Command]:
        return (
            db.session.query(Command)
            .filter(Command.status == CommandStatus.SENT.value, Command.sent_at < cutoff)
            .all()
        )
