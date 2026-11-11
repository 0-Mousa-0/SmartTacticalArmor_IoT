"""Data access for OPERATOR. No business rules, no commits (see facade UoW)."""
from app.extensions import db
from app.models.operator import Operator


class OperatorRepository:
    def add(self, operator: Operator) -> Operator:
        db.session.add(operator)
        db.session.flush()
        return operator

    def get(self, operator_id: str) -> Operator | None:
        return db.session.get(Operator, operator_id)

    def get_by_email(self, email: str) -> Operator | None:
        return db.session.query(Operator).filter(Operator.email == email.strip().lower()).first()

    def list_all(self) -> list[Operator]:
        return db.session.query(Operator).order_by(Operator.full_name).all()

    def count_active_admins(self) -> int:
        return db.session.query(Operator).filter_by(role="admin", is_active=True).count()

    def count(self) -> int:
        return db.session.query(Operator).count()
