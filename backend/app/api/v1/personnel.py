"""Personnel namespace — /api/v1/personnel (field members who wear vests)."""
from flask_restx import Namespace, Resource, fields

from app.api.v1.common import arg_bool, body, call
from app.api.v1.security import ADMIN, auth_required
from app.services.facade import get_facade

ns = Namespace("personnel", description="Field members (vest wearers)")

_fields = {
    "callsign": fields.String(example="ALPHA-01"),
    "full_name": fields.String(example="Field Member 01"),
    "rank": fields.String(),
    "unit_name": fields.String(),
    "blood_type": fields.String(description="A+, A-, B+, B-, AB+, AB-, O+ or O- (case-insensitive)"),
    "zone": fields.String(example="Al Olaya"),
    "post_lat": fields.Float(example=24.6905),
    "post_lng": fields.Float(example=46.6854),
    "notes": fields.String(),
}
create_model = ns.model("CreatePersonnel", {**_fields,
                                            "callsign": fields.String(required=True, example="ALPHA-01"),
                                            "full_name": fields.String(required=True, example="Field Member 01")})
update_model = ns.model("UpdatePersonnel", _fields)


@ns.route("")
class PersonnelCollection(Resource):
    @auth_required()
    @ns.param("include_inactive", "Include deactivated personnel", type=bool)
    def get(self):
        """List field personnel."""
        return call(ns, lambda: get_facade().list_personnel(arg_bool("include_inactive")))

    @auth_required(ADMIN)
    @ns.expect(create_model, validate=True)
    def post(self):
        """Add a field member."""
        return call(ns, lambda: get_facade().create_personnel(body())), 201


@ns.route("/<string:personnel_id>")
class PersonnelItem(Resource):
    @auth_required()
    def get(self, personnel_id):
        return call(ns, lambda: get_facade().get_personnel(personnel_id))

    @auth_required(ADMIN)
    @ns.expect(update_model, validate=True)
    def patch(self, personnel_id):
        return call(ns, lambda: get_facade().update_personnel(personnel_id, body()))

    @auth_required(ADMIN)
    def delete(self, personnel_id):
        """Deactivate (history is kept) and release their vest."""
        return call(ns, lambda: get_facade().deactivate_personnel(personnel_id))
