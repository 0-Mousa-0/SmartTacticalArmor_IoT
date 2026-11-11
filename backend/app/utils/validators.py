"""Field validators used by SQLAlchemy ``@validates`` hooks and the facade.

All raise ``ValueError`` with a client-safe message; the API layer turns
that into an HTTP 400 (see ``app/__init__.py``).
"""
import math
import re

_EMAIL_RE = re.compile(r"^[^@\s,]+@[^@\s,]+\.[^@\s,]+$")
DEVICE_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{2,32}$")
_CALLSIGN_RE = re.compile(r"^[\w\- ]{2,32}$", re.UNICODE)


def require_text(value, field: str, max_length: int) -> str:
    if value is None or not str(value).strip():
        raise ValueError(f"{field} is required")
    cleaned = " ".join(str(value).split())
    if len(cleaned) > max_length:
        raise ValueError(f"{field} must be at most {max_length} characters")
    return cleaned


def optional_text(value, field: str, max_length: int) -> str | None:
    if value is None or not str(value).strip():
        return None
    return require_text(value, field, max_length)


def require_email(value) -> str:
    cleaned = require_text(value, "email", 255).lower()
    if not _EMAIL_RE.match(cleaned):
        raise ValueError("email is not a valid email address")
    return cleaned


def require_one_of(value, field: str, allowed) -> str:
    if value not in allowed:
        raise ValueError(f"{field} must be one of: {', '.join(allowed)}")
    return value


def require_device_code(value) -> str:
    cleaned = require_text(value, "device_code", 32).upper()
    if not DEVICE_CODE_RE.match(cleaned):
        raise ValueError("device_code may contain only letters, digits, '-' and '_' (2-32 chars)")
    return cleaned


def require_callsign(value) -> str:
    cleaned = require_text(value, "callsign", 32).upper()
    if not _CALLSIGN_RE.match(cleaned):
        raise ValueError("callsign may contain only letters, digits, spaces, '-' and '_'")
    return cleaned


def optional_coordinate(value, field: str, limit: float) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be a number") from None
    if not math.isfinite(number) or abs(number) > limit:
        raise ValueError(f"{field} must be between -{limit} and {limit}")
    return number


def validate_password(value) -> str:
    if value is None or len(str(value)) < 8:
        raise ValueError("password must be at least 8 characters")
    if len(str(value)) > 128:
        raise ValueError("password must be at most 128 characters")
    return str(value)
