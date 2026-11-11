"""Operator-account management (admin only)."""
from app.models.enums import OperatorRole
from app.models.operator import Operator
from app.services.facade.errors import FacadeError


class OperatorFacadeMixin:
    def list_operators(self) -> list[dict]:
        return [operator.to_dict() for operator in self.operators.list_all()]

    def create_operator(self, *, email: str, full_name: str, role: str, password: str) -> dict:
        with self.transaction():
            if self.operators.get_by_email(email or ""):
                raise FacadeError("An operator with this email already exists", 409)
            operator = Operator(email=email, full_name=full_name, role=role or OperatorRole.OPERATOR.value)
            operator.set_password(password)
            self.operators.add(operator)
            result = operator.to_dict()
        return result

    def update_operator(self, operator_id: str, data: dict) -> dict:
        with self.transaction():
            operator = self.operators.get(operator_id)
            if operator is None:
                raise FacadeError("Operator not found", 404)
            is_admin = operator.role == OperatorRole.ADMIN.value and operator.is_active
            demoting = "role" in data and data["role"] != OperatorRole.ADMIN.value
            deactivating = data.get("is_active") is False
            if is_admin and (demoting or deactivating) and self.operators.count_active_admins() <= 1:
                raise FacadeError("Cannot demote or disable the last active administrator", 409)
            if "full_name" in data:
                operator.full_name = data["full_name"]
            if "role" in data:
                operator.role = data["role"]
            if "is_active" in data:
                operator.is_active = bool(data["is_active"])
            if data.get("password"):
                operator.set_password(data["password"])
            result = operator.to_dict()
        return result
