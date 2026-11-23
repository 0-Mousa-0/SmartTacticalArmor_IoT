"""Authentication + role-based access control for the REST API.

Roles:  viewer  -> read-only
        operator -> + acknowledge/resolve alerts, send commands to vests
        admin    -> + manage vests, personnel and operator accounts

Public access: when PUBLIC_ACCESS_ROLE is set, a request WITHOUT a session
token is served as an anonymous visitor with that role (g.operator_id is
None). A request that sends a token is always that operator, and a bad or
expired token is still rejected.
"""
from functools import wraps

from flask import current_app, g, request
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


def public_access_role() -> str:
    """Role of visitors without a session, or "" when sign-in is required."""
    return current_app.config.get("PUBLIC_ACCESS_ROLE") or ""


def public_profile(role: str) -> dict:
    """What /auth/me returns for an anonymous visitor in public-access mode."""
    return {
        "operator_id": None,
        "full_name": "Public access",
        "email": None,
        "role": role,
        "is_active": True,
        "last_login_at": None,
        "created_at": None,
        "public": True,
    }


def auth_required(roles: tuple[str, ...] = ANY_ROLE):
    """Require a valid session (or public access); optionally restrict to ``roles``."""

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            token = _bearer_token()
            if token is None:
                role = public_access_role()
                if not role:
                    abort(401, "Missing or malformed Authorization header")
                operator_id = None  # anonymous visitor
            else:
                try:
                    operator = get_facade().authenticate_token(token)
                except FacadeError as error:
                    abort(error.status, error.message)
                operator_id, role = operator.operator_id, operator.role
            if roles and role not in roles:
                abort(403, "Your role does not allow this action")
            g.operator_id = operator_id
            g.operator_role = role
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def client_ip() -> str:
    return request.remote_addr or "unknown"  # ProxyFix makes this the real client IP on Render
