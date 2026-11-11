"""Operator session tokens (JWT, HS256, signed with SECRET_KEY)."""
import time

import jwt

ISSUER = "sta-api"


def issue_access_token(*, operator_id: str, role: str, name: str, secret: str, expires_minutes: int) -> tuple[str, int]:
    now = int(time.time())
    lifetime = max(60, expires_minutes * 60)
    payload = {
        "sub": operator_id,
        "role": role,
        "name": name,
        "type": "access",
        "iss": ISSUER,
        "iat": now,
        "exp": now + lifetime,
    }
    return jwt.encode(payload, secret, algorithm="HS256"), lifetime


def decode_access_token(token: str, secret: str) -> dict:
    """Raises ``jwt.InvalidTokenError`` (or a subclass) when invalid."""
    payload = jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        issuer=ISSUER,
        options={"require": ["exp", "iat", "sub", "iss"]},
    )
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("not an access token")
    return payload
