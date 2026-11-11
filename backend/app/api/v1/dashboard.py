"""Read-model namespaces for the dashboard pages:

  GET  /api/v1/overview                    command-centre overview
  GET  /api/v1/analysis                    AI analysis: risk ranking, baselines, findings
  GET  /api/v1/armor/shielding             radiation-shielding research dataset
  POST /api/v1/armor/shielding/estimate    transmission / dose behind the shield
  GET  /api/v1/health                      liveness + dependencies (public)
"""
from flask_restx import Namespace, Resource, fields

from app.api.v1.common import body, call
from app.api.v1.security import auth_required
from app.services.facade import get_facade

overview_ns = Namespace("overview", description="Command-centre overview")
analysis_ns = Namespace("analysis", description="AI analysis (explainable)")
armor_ns = Namespace("armor", description="Armor profile and shielding model")
health_ns = Namespace("health", description="Service health (no auth)")

estimate_model = armor_ns.model("ShieldingEstimate", {
    "material": fields.String(required=True, enum=["bi2o3", "pbo", "mgo"], example="bi2o3"),
    "beam": fields.String(required=True, enum=["xray", "am241", "cs137"], example="cs137"),
    "concentration_wt_pct": fields.Float(required=True, example=8.333),
    "thickness_cm": fields.Float(required=True, example=1.0),
    "incident_dose_usvh": fields.Float(example=10.0),
})


@overview_ns.route("")
class Overview(Resource):
    @auth_required()
    def get(self):
        return call(overview_ns, lambda: get_facade().get_overview())


@analysis_ns.route("")
class Analysis(Resource):
    @auth_required()
    def get(self):
        return call(analysis_ns, lambda: get_facade().get_analysis_summary())


@armor_ns.route("/shielding")
class ShieldingDataset(Resource):
    @auth_required()
    def get(self):
        return call(armor_ns, lambda: get_facade().get_shielding_dataset())


@armor_ns.route("/shielding/estimate")
class ShieldingEstimate(Resource):
    @auth_required()
    @armor_ns.expect(estimate_model, validate=True)
    def post(self):
        return call(armor_ns, lambda: get_facade().estimate_shielding(body()))


@health_ns.route("")
class Health(Resource):
    @health_ns.doc(security=[])
    def get(self):
        """Public liveness probe (Render health check / uptime monitor)."""
        health = get_facade().system_health()
        mqtt = health["mqtt"]
        public = {
            "status": health["status"],
            "database": health["database"],
            "mqtt": {"enabled": mqtt.get("enabled", False), "connected": mqtt.get("connected", False)},
            "version": health["version"],
            "time": health["time"],
        }
        return public, (200 if health["status"] == "ok" else 503)
