"""Devices namespace — /api/v1/devices (the smart vests, a.k.a. units)

  GET    /                         all vests with live state + AI risk
  POST   /                         register a vest (admin)
  GET    /<id>                     one vest
  PATCH  /<id>                     rename / assign wearer / flags (admin)
  DELETE /<id>                     retire (admin)
  GET    /<id>/telemetry           history for charts (?minutes=30)
  GET    /<id>/commands            recent commands
  POST   /<id>/commands            send a command (operator)
"""
from flask import g
from flask_restx import Namespace, Resource, fields

from app.api.v1.common import arg_bool, arg_int, body, call
from app.api.v1.security import ADMIN, OPERATE, auth_required
from app.services.facade import get_facade

ns = Namespace("devices", description="Smart vests: live state, history and commands")

register_model = ns.model("RegisterDevice", {
    "device_code": fields.String(required=True, example="STA-01", description="Must equal DEVICE_ID in firmware"),
    "display_name": fields.String(example="Vest STA-01"),
    "is_simulated": fields.Boolean(default=False),
    "personnel_id": fields.String(description="Wearer to assign"),
    "notes": fields.String(),
})
update_model = ns.model("UpdateDevice", {
    "display_name": fields.String(),
    "is_simulated": fields.Boolean(),
    "personnel_id": fields.String(description="Wearer (empty string to unassign)"),
    "is_active": fields.Boolean(),
    "notes": fields.String(),
})
command_model = ns.model("SendCommand", {
    "command_type": fields.String(required=True, enum=["ping", "ack", "evac", "stop", "interval",
                                                       "silent", "calibrate", "status"]),
    "params": fields.Raw(example={"sec": 2}, description="interval: {sec 1..60}; silent: {on: bool}"),
})


@ns.route("")
class DeviceCollection(Resource):
    @auth_required()
    @ns.param("include_inactive", "Include retired vests", type=bool)
    def get(self):
        return call(ns, lambda: get_facade().list_devices(arg_bool("include_inactive")))

    @auth_required(ADMIN)
    @ns.expect(register_model, validate=True)
    @ns.response(409, "Device code already registered")
    def post(self):
        return call(ns, lambda: get_facade().register_device(body())), 201


@ns.route("/<string:device_id>")
class DeviceItem(Resource):
    @auth_required()
    def get(self, device_id):
        return call(ns, lambda: get_facade().get_device(device_id))

    @auth_required(ADMIN)
    @ns.expect(update_model, validate=True)
    def patch(self, device_id):
        return call(ns, lambda: get_facade().update_device(device_id, body()))

    @auth_required(ADMIN)
    def delete(self, device_id):
        return call(ns, lambda: get_facade().retire_device(device_id))


@ns.route("/<string:device_id>/telemetry")
class DeviceTelemetry(Resource):
    @auth_required()
    @ns.param("minutes", "Window length (1..1440)", type=int, default=30)
    @ns.param("limit", "Max points (10..5000)", type=int, default=720)
    def get(self, device_id):
        return call(ns, lambda: get_facade().get_telemetry_history(
            device_id, arg_int("minutes", 30), arg_int("limit", 720)))


@ns.route("/<string:device_id>/commands")
class DeviceCommands(Resource):
    @auth_required()
    @ns.param("limit", "Max commands", type=int, default=20)
    def get(self, device_id):
        return call(ns, lambda: get_facade().list_commands(device_id, arg_int("limit", 20)))

    @auth_required(OPERATE)
    @ns.expect(command_model, validate=True)
    @ns.response(201, "Command published (status 'sent') or failed (status 'failed')")
    def post(self, device_id):
        data = body()
        return call(ns, lambda: get_facade().send_command(
            device_id, data.get("command_type"), data.get("params") or {}, g.operator_id)), 201
