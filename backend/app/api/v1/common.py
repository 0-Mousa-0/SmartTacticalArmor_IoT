"""Helpers shared by every namespace."""
from flask import request

from app.services.facade import FacadeError


def call(ns, fn):
    """Run a facade call and turn FacadeError into an HTTP error response."""
    try:
        return fn()
    except FacadeError as error:
        ns.abort(error.status, error.message)


def body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def arg_int(name: str, default: int) -> int:
    try:
        return int(request.args.get(name, default))
    except (TypeError, ValueError):
        return default


def arg_bool(name: str, default: bool = False) -> bool:
    raw = request.args.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def arg_str(name: str) -> str | None:
    raw = request.args.get(name)
    return raw.strip() if raw and raw.strip() else None
