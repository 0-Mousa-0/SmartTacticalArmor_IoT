"""Vest status reports (retained message + MQTT Last Will)."""
from datetime import datetime

from app.models.base_model import utcnow
from app.services.ingest import parse_status


class StatusFacadeMixin:
    def ingest_status(self, device_code: str, raw, received_at: datetime | None = None,
                      retained: bool = False) -> dict | None:
        """``retained`` messages are replayed by the broker on every reconnect,
        so they update the vest's metadata but never count as "seen now"."""
        received_at = received_at or utcnow()
        payload = parse_status(device_code, raw)
        with self.transaction():
            device = self._resolve_device(payload.device_code, simulated=payload.simulated)
            if device is None:
                return None
            device.reported_online = payload.online
            device.last_status_at = received_at
            if payload.online:
                if payload.firmware_version:
                    device.firmware_version = payload.firmware_version
                if payload.ip_address:
                    device.ip_address = payload.ip_address
                if payload.rssi is not None:
                    device.rssi = payload.rssi
                if payload.sensors is not None:
                    device.sensors = payload.sensors
                if payload.interval_s is not None:
                    device.telemetry_interval_s = payload.interval_s
                if payload.buzzer is not None:
                    device.buzzer_enabled = payload.buzzer
                if not retained:
                    self._mark_seen(device, received_at)
            self._refresh_risk(device, received_at)
            result = {"device_code": device.device_code, "online": payload.online}
        return result
