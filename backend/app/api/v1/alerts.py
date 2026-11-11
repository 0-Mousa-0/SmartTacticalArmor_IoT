"""Alerts namespace — /api/v1/alerts (incidents, prioritised)

  GET  /                       ?scope=open|closed|all&severity=&type=&source=&device_id=&since_hours=
  GET  /summary                open counts by severity
  GET  /<id>                   incident + timeline
  POST /<id>/acknowledge       operator: "help is coming" (also buzzes the vest)
  POST /<id>/resolve           operator: close with a note
"""
from flask import g
from flask_restx import Namespace, Resource, fields

from app.api.v1.common import arg_int, arg_str, body, call
from app.api.v1.security import OPERATE, auth_required
from app.services.facade import get_facade

ns = Namespace("alerts", description="Incidents raised by vests and by the AI analysis")

note_model = ns.model("AlertNote", {"note": fields.String(example="Medic dispatched")})


@ns.route("")
class AlertCollection(Resource):
    @auth_required()
    @ns.param("scope", "open | closed | all", default="open")
    @ns.param("severity", "info | warning | critical")
    @ns.param("type", "Alert type, e.g. FALL")
    @ns.param("source", "device | analysis")
    @ns.param("device_id", "Filter by vest")
    @ns.param("since_hours", "Only incidents active in the last N hours", type=float)
    @ns.param("limit", "Page size (max 200)", type=int, default=50)
    @ns.param("offset", "Page offset", type=int, default=0)
    def get(self):
        return call(ns, lambda: get_facade().list_alerts(
            scope=arg_str("scope") or "open",
            severity=arg_str("severity"),
            alert_type=(arg_str("type") or "").upper() or None,
            source=arg_str("source"),
            device_id=arg_str("device_id"),
            since_hours=arg_str("since_hours"),
            limit=arg_int("limit", 50),
            offset=arg_int("offset", 0),
        ))


@ns.route("/summary")
class AlertSummary(Resource):
    @auth_required()
    def get(self):
        return call(ns, lambda: get_facade().alert_summary())


@ns.route("/<string:alert_id>")
class AlertItem(Resource):
    @auth_required()
    def get(self, alert_id):
        return call(ns, lambda: get_facade().get_alert(alert_id))


@ns.route("/<string:alert_id>/acknowledge")
class AlertAcknowledge(Resource):
    @auth_required(OPERATE)
    @ns.expect(note_model)
    def post(self, alert_id):
        return call(ns, lambda: get_facade().acknowledge_alert(alert_id, g.operator_id, body().get("note")))


@ns.route("/<string:alert_id>/resolve")
class AlertResolve(Resource):
    @auth_required(OPERATE)
    @ns.expect(note_model)
    def post(self, alert_id):
        return call(ns, lambda: get_facade().resolve_alert(alert_id, g.operator_id, body().get("note")))
