"""Commands from the operations room to a vest.

    queued --publish ok--> sent --resp ok--> acknowledged
       |                     |--resp !ok--> failed
       +--publish fail--> failed            +--no resp--> timeout (housekeeping)
"""
import secrets
from datetime import datetime

from app.models.base_model import utcnow
from app.models.command import Command
from app.models.enums import CommandStatus, CommandType, values
from app.services.facade.errors import FacadeError
from app.services.ingest import parse_command_response


class CommandFacadeMixin:
    def send_command(self, device_id: str, command_type: str, params: dict | None, operator_id: str | None,
                     alert_id: str | None = None) -> dict:
        command_type = (command_type or "").strip().lower()
        if command_type not in values(CommandType):
            raise FacadeError(f"command_type must be one of: {', '.join(values(CommandType))}", 400)
        params = self._validate_command_params(command_type, params or {})

        with self.transaction():
            device = self._require_device(device_id)
            if not device.is_active:
                raise FacadeError("Device is retired", 409)
            command = self.commands.add(Command(
                device_id=device.device_id,
                issued_by=operator_id,
                alert_id=alert_id,
                command_type=command_type,
                params=params,
                correlation_id=secrets.token_hex(4),
                status=CommandStatus.QUEUED.value,
                issued_at=utcnow(),
            ))
            command_id, device_code, cid = command.command_id, device.device_code, command.correlation_id

        # Publish outside the DB transaction: never hold a connection while
        # waiting on the broker.
        delivered = self.publisher.publish_command(device_code, {"cmd": command_type, "cid": cid, **params})

        with self.transaction():
            command = self.commands.get(command_id)
            now = utcnow()
            # A fast vest can answer before we get here: never overwrite a
            # status the response already set (acknowledged / failed).
            if delivered:
                command.sent_at = command.sent_at or now
                if command.status == CommandStatus.QUEUED.value:
                    command.status = CommandStatus.SENT.value
            elif command.status == CommandStatus.QUEUED.value:
                command.status = CommandStatus.FAILED.value
                command.response_info = "Command channel offline (MQTT not connected)"
                command.completed_at = now
            result = command.to_dict()
        return result

    @staticmethod
    def _validate_command_params(command_type: str, params: dict) -> dict:
        if command_type == CommandType.INTERVAL:
            try:
                seconds = int(params.get("sec"))
            except (TypeError, ValueError):
                raise FacadeError("interval needs an integer 'sec'", 400) from None
            if not 1 <= seconds <= 60:
                raise FacadeError("interval 'sec' must be between 1 and 60", 400)
            return {"sec": seconds}
        if command_type == CommandType.SILENT:
            if not isinstance(params.get("on"), bool):
                raise FacadeError("silent needs a boolean 'on'", 400)
            return {"on": params["on"]}
        if command_type == CommandType.ACK and params.get("type"):
            return {"type": str(params["type"]).upper()[:32]}
        return {}

    def ingest_command_response(self, device_code: str, raw, received_at: datetime | None = None) -> dict | None:
        received_at = received_at or utcnow()
        payload = parse_command_response(device_code, raw)
        with self.transaction():
            device = self._resolve_device(payload.device_code)
            if device is None:
                return None
            self._mark_seen(device, received_at)
            command = self.commands.get_by_correlation(payload.correlation_id) if payload.correlation_id else None
            if command is None or command.device_id != device.device_id:
                command = self.commands.latest_open_of_type(device.device_id, payload.command)
            # QUEUED is accepted too: the reply may beat send_command's own
            # "mark as sent" step when the broker round trip is very short.
            answerable = (CommandStatus.QUEUED.value, CommandStatus.SENT.value, CommandStatus.TIMEOUT.value)
            if command is None or command.status not in answerable:
                return None
            command.sent_at = command.sent_at or received_at
            command.status = CommandStatus.ACKNOWLEDGED.value if payload.ok else CommandStatus.FAILED.value
            command.response_ok = payload.ok
            command.response_info = payload.info
            command.completed_at = received_at
            if payload.ok and command.command_type == CommandType.INTERVAL:
                device.telemetry_interval_s = (command.params or {}).get("sec", device.telemetry_interval_s)
            if payload.ok and command.command_type == CommandType.SILENT:
                device.buzzer_enabled = not (command.params or {}).get("on", True)
            result = command.to_dict()
        return result

    def list_commands(self, device_id: str, limit: int = 20) -> list[dict]:
        device = self._require_device(device_id)
        limit = max(1, min(int(limit), 100))
        return [command.to_dict() for command in self.commands.list_for_device(device.device_id, limit)]
