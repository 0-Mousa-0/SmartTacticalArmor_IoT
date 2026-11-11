"""Data access for DEVICE."""
from app.extensions import db
from app.models.device import Device


class DeviceRepository:
    def add(self, device: Device) -> Device:
        db.session.add(device)
        db.session.flush()
        return device

    def get(self, device_id: str) -> Device | None:
        return db.session.get(Device, device_id)

    def get_by_code(self, device_code: str) -> Device | None:
        return db.session.query(Device).filter(Device.device_code == device_code.strip().upper()).first()

    def get_by_personnel(self, personnel_id: str) -> Device | None:
        return db.session.query(Device).filter(Device.personnel_id == personnel_id).first()

    def list(self, include_inactive: bool = False) -> list[Device]:
        query = db.session.query(Device)
        if not include_inactive:
            query = query.filter(Device.is_active.is_(True))
        return query.order_by(Device.device_code).all()
