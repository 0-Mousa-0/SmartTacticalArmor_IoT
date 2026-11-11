"""Data access for PERSONNEL."""
from app.extensions import db
from app.models.personnel import Personnel


class PersonnelRepository:
    def add(self, person: Personnel) -> Personnel:
        db.session.add(person)
        db.session.flush()
        return person

    def get(self, personnel_id: str) -> Personnel | None:
        return db.session.get(Personnel, personnel_id)

    def get_by_callsign(self, callsign: str) -> Personnel | None:
        return db.session.query(Personnel).filter(Personnel.callsign == callsign.strip().upper()).first()

    def list(self, include_inactive: bool = False) -> list[Personnel]:
        query = db.session.query(Personnel)
        if not include_inactive:
            query = query.filter(Personnel.is_active.is_(True))
        return query.order_by(Personnel.callsign).all()
