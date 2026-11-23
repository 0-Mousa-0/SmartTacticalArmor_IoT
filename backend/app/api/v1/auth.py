"""Auth namespace — /api/v1/auth

  POST /login             email + password -> session token (JWT)
  GET  /me                current operator profile (or the public-access profile)
  POST /change-password   change own password
"""
from flask import g
from flask_restx import Namespace, Resource, abort, fields

from app.api.v1.common import body, call
from app.api.v1.security import auth_required, client_ip, public_profile
from app.services.facade import get_facade

ns = Namespace("auth", description="Operator sign-in and profile")

login_model = ns.model("LoginRequest", {
    "email": fields.String(required=True, example="admin@sta.local"),
    "password": fields.String(required=True, example="••••••••"),
})
password_model = ns.model("ChangePasswordRequest", {
    "current_password": fields.String(required=True),
    "new_password": fields.String(required=True, min_length=8),
})


@ns.route("/login")
class Login(Resource):
    @ns.doc(security=[])
    @ns.expect(login_model, validate=True)
    @ns.response(200, "Signed in")
    @ns.response(401, "Invalid email or password")
    @ns.response(429, "Too many failed attempts")
    def post(self):
        """Sign in and receive a Bearer token."""
        data = body()
        return call(ns, lambda: get_facade().login(data.get("email"), data.get("password"), client_ip()))


@ns.route("/me")
class Me(Resource):
    @auth_required()
    def get(self):
        """Current operator profile.

        Without a token in public-access mode this returns ``"public": true``
        and the visitor role, which tells the dashboard to skip the sign-in page.
        """
        if g.operator_id is None:
            return public_profile(g.operator_role)
        return call(ns, lambda: get_facade().get_profile(g.operator_id))


@ns.route("/change-password")
class ChangePassword(Resource):
    @auth_required()
    @ns.expect(password_model, validate=True)
    def post(self):
        """Change the signed-in operator's password."""
        if g.operator_id is None:
            abort(403, "Public access has no account password")
        data = body()
        return call(ns, lambda: get_facade().change_password(
            g.operator_id, data.get("current_password"), data.get("new_password")))
