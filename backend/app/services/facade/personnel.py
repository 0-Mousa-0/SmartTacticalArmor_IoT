"""Field-personnel management."""
from app.models.personnel import Personnel
from app.services.facade.errors import FacadeError
from app.utils.validators import require_callsign

PERSONNEL_FIELDS = ("callsign", "full_name", "rank", "unit_name", "blood_type", "zone", "post_lat", "post_lng", "notes")


class PersonnelFacadeMixin:
    def list_personnel(self, include_inactive: bool = False) -> list[dict]:
        return [person.to_dict() for person in self.personnel.list(include_inactive)]

    def get_personnel(self, personnel_id: str) -> dict:
        return self._require_personnel(personnel_id).to_dict()

    def create_personnel(self, data: dict) -> dict:
        with self.transaction():
            callsign = require_callsign(data.get("callsign"))
            if self.personnel.get_by_callsign(callsign):
                raise FacadeError(f"Callsign {callsign} is already in use", 409)
            person = Personnel(**{field: data.get(field) for field in PERSONNEL_FIELDS if field in data})
            self.personnel.add(person)
            result = person.to_dict()
        return result

    def update_personnel(self, personnel_id: str, data: dict) -> dict:
        with self.transaction():
            person = self._require_personnel(personnel_id)
            if "callsign" in data:
                callsign = require_callsign(data["callsign"])
                holder = self.personnel.get_by_callsign(callsign)
                if holder and holder.personnel_id != person.personnel_id:
                    raise FacadeError(f"Callsign {callsign} is already in use", 409)
            for field in PERSONNEL_FIELDS:
                if field in data:
                    setattr(person, field, data[field])
            result = person.to_dict()
        return result

    def deactivate_personnel(self, personnel_id: str) -> dict:
        with self.transaction():
            person = self._require_personnel(personnel_id)
            person.is_active = False
            device = self.devices.get_by_personnel(personnel_id)
            if device is not None:
                device.personnel = None
            result = person.to_dict()
        return result

    def _require_personnel(self, personnel_id: str) -> Personnel:
        person = self.personnel.get(personnel_id) if personnel_id else None
        if person is None:
            raise FacadeError("Personnel not found", 404)
        return person
