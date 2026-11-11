"""Operators namespace — /api/v1/operators (admin only)."""
from flask_restx import Namespace, Resource, fields

from app.api.v1.common import body, call
from app.api.v1.security import ADMIN, auth_required
from app.services.facade import get_facade

ns = Namespace("operators", description="Dashboard accounts and roles (admin)")

ROLES = ["admin", "operator", "viewer"]
create_model = ns.model("CreateOperator", {
    "email": fields.String(required=True, example="ops1@sta.local"),
    "full_name": fields.String(required=True, example="Duty Officer 1"),
    "role": fields.String(required=True, enum=ROLES, example="operator"),
    "password": fields.String(required=True, min_length=8),
})
update_model = ns.model("UpdateOperator", {
    "full_name": fields.String(),
    "role": fields.String(enum=ROLES),
    "is_active": fields.Boolean(),
    "password": fields.String(min_length=8),
})


@ns.route("")
class OperatorCollection(Resource):
    @auth_required(ADMIN)
    def get(self):
        """List operator accounts."""
        return call(ns, lambda: get_facade().list_operators())

    @auth_required(ADMIN)
    @ns.expect(create_model, validate=True)
    @ns.response(409, "Email already in use")
    def post(self):
        """Create an operator account."""
        data = body()
        return call(ns, lambda: get_facade().create_operator(
            email=data.get("email"), full_name=data.get("full_name"),
            role=data.get("role"), password=data.get("password"))), 201


@ns.route("/<string:operator_id>")
class OperatorItem(Resource):
    @auth_required(ADMIN)
    @ns.expect(update_model, validate=True)
    def patch(self, operator_id):
        """Rename, change role, enable/disable or reset password."""
        return call(ns, lambda: get_facade().update_operator(operator_id, body()))
