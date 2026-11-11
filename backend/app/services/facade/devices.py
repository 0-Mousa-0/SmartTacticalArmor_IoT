"""Vest (device) management and read models."""
from datetime import timedelta

from app.models.base_model import utcnow
from app.models.device import Device
from app.services.facade.errors import FacadeError
from app.utils.validators import require_device_code


class DeviceFacadeMixin:
    def list_devices(self, include_inactive: bool = False) -> list[dict]:
        now = utcnow()
        grouped = self._open_alerts_by_device()
        return [self._device_view(d, now, grouped.get(d.device_id, [])) for d in self.devices.list(include_inactive)]

    def get_device(self, device_id: str) -> dict:
        device = self._require_device(device_id)
        return self._device_view(device, utcnow(), self.alerts.open_for_device(device.device_id))

    def register_device(self, data: dict) -> dict:
        with self.transaction():
            code = require_device_code(data.get("device_code"))
            if self.devices.get_by_code(code):
                raise FacadeError(f"Device {code} is already registered", 409)
            device = self.devices.add(Device(
                device_code=code,
                display_name=data.get("display_name") or f"Vest {code}",
                is_simulated=bool(data.get("is_simulated", False)),
                notes=data.get("notes"),
                telemetry_interval_s=self._cfg("DEVICE_DEFAULT_INTERVAL_S"),
            ))
            if data.get("personnel_id"):
                self._assign_wearer(device, data["personnel_id"])
            device_id = device.device_id
        return self.get_device(device_id)

    def update_device(self, device_id: str, data: dict) -> dict:
        with self.transaction():
            device = self._require_device(device_id)
            for field in ("display_name", "notes"):
                if field in data:
                    setattr(device, field, data[field])
            if "is_simulated" in data:
                device.is_simulated = bool(data["is_simulated"])
            if "personnel_id" in data:
                self._assign_wearer(device, data["personnel_id"])
            if "is_active" in data:
                device.is_active = bool(data["is_active"])
                if not device.is_active:
                    device.personnel = None
        return self.get_device(device_id)

    def retire_device(self, device_id: str) -> dict:
        return self.update_device(device_id, {"is_active": False})

    def get_telemetry_history(self, device_id: str, minutes: int = 30, limit: int = 720) -> dict:
        device = self._require_device(device_id)
        minutes = max(1, min(int(minutes), 24 * 60))
        limit = max(10, min(int(limit), 5000))
        rows = self.telemetry.history(device.device_id, utcnow() - timedelta(minutes=minutes), limit)
        return {
            "device_id": device.device_id,
            "device_code": device.device_code,
            "minutes": minutes,
            "points": [row.to_dict() for row in rows],
        }

    def _assign_wearer(self, device: Device, personnel_id: str | None) -> None:
        if not personnel_id:
            device.personnel = None
            return
        person = self.personnel.get(personnel_id)
        if person is None:
            raise FacadeError("Personnel not found", 404)
        if not person.is_active:
            raise FacadeError(f"{person.callsign} is inactive", 409)
        holder = self.devices.get_by_personnel(personnel_id)
        if holder is not None and holder.device_id != device.device_id:
            raise FacadeError(f"{person.callsign} already wears {holder.device_code}", 409)
        device.personnel = person
