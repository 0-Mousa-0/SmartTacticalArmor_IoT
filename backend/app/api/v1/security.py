"""Authentication + role-based access control for the REST API.

Roles:  viewer  -> read-only
        operator -> + acknowledge/resolve alerts, send commands to vests
        admin    -> + manage vests, personnel and operator accounts
"""
from functools import wraps

from flask import g, request
from flask_restx import abort

from app.services.facade import FacadeError, get_facade

ANY_ROLE: tuple[str, ...] = ()
OPERATE = ("operator", "admin")
ADMIN = ("admin",)


def _bearer_token() -> str | None:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = header[7:].strip()
    return token or None


def auth_required(roles: tuple[str, ...] = ANY_ROLE):
    """Require a valid session; optionally restrict to ``roles``."""

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            token = _bearer_token()
            if token is None:
                abort(401, "Missing or malformed Authorization header")
            try:
                operator = get_facade().authenticate_token(token)
            except FacadeError as error:
                abort(error.status, error.message)
            if roles and operator.role not in roles:
                abort(403, "Your role does not allow this action")
            g.operator_id = operator.operator_id
            g.operator_role = operator.role
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def client_ip() -> str:
    return request.remote_addr or "unknown"  # ProxyFix makes this the real client IP on Render
