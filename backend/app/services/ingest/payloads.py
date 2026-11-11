"""Anti-corruption layer between the vest's MQTT protocol and the domain.

Every message from a vest is untrusted input: it is type-checked, bounded
and normalised here before any business logic sees it. Out-of-range sensor
values are dropped (set to None) rather than rejecting the whole message,
so one glitchy sensor never hides the rest of the telemetry.

Wire format: docs/05-mqtt-protocol.md
"""
import ipaddress
import math
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.models.alert_catalog import ALERT_CATALOG
from app.models.enums import AlertSource, DeviceAlertState, Posture, Severity, values
from app.utils.validators import DEVICE_CODE_RE


class PayloadError(ValueError):
    """The message cannot be interpreted; it is logged and dropped."""


# ── primitive coercion helpers ───────────────────────────────
def _num(value, lo: float, hi: float) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number < lo or number > hi:
        return None
    return number


def _int(value, lo: int, hi: int) -> int | None:
    number = _num(value, lo, hi)
    return int(round(number)) if number is not None else None


def _flag(value) -> bool | None:
    if isinstance(value, bool):
        return value
    if value in (0, 1):
        return bool(value)
    return None


def _text(value, max_length: int) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned[:max_length] if cleaned else None


def _epoch(value) -> datetime | None:
    seconds = _int(value, 1_600_000_000, 4_102_444_800)  # 2020 .. 2100
    return datetime.fromtimestamp(seconds, tz=UTC) if seconds else None


def _section(raw: dict, key: str) -> dict:
    value = raw.get(key)
    return value if isinstance(value, dict) else {}


def _check_identity(device_code: str, raw) -> str:
    if not isinstance(raw, dict):
        raise PayloadError("payload must be a JSON object")
    code = (device_code or "").strip().upper()
    if not DEVICE_CODE_RE.match(code):
        raise PayloadError("invalid device code in topic")
    claimed = raw.get("id")
    if claimed is not None and str(claimed).strip().upper() != code:
        raise PayloadError("payload id does not match the topic device")
    return code


# ── telemetry ────────────────────────────────────────────────
METRIC_FIELDS = ("vest_temp_c", "activity_g", "heart_rate", "spo2", "skin_temp_c", "radiation_usvh")


@dataclass(frozen=True)
class TelemetryPayload:
    device_code: str
    seq: int | None = None
    uptime_s: int | None = None
    device_ts: datetime | None = None
    # Phase 1: MPU-6050
    vest_temp_c: float | None = None
    tilt_deg: float | None = None
    posture: str | None = None
    activity_g: float | None = None
    peak_g: float | None = None
    still_s: int | None = None
    rssi: int | None = None
    alert_mask: int = 0
    prealert: bool = False
    # Phase 2+: vitals, GPS, radiation, battery
    heart_rate: int | None = None
    spo2: int | None = None
    skin_temp_c: float | None = None
    sensor_contact: bool | None = None
    lat: float | None = None
    lng: float | None = None
    gps_fix: bool | None = None
    gps_sats: int | None = None
    radiation_usvh: float | None = None
    radiation_cpm: int | None = None
    radiation_dose_usv: float | None = None
    battery_pct: int | None = None
    battery_v: float | None = None

    def metrics(self) -> dict[str, float]:
        """Numeric values the AI analysis tracks (only those present)."""
        return {name: float(getattr(self, name)) for name in METRIC_FIELDS if getattr(self, name) is not None}

    def snapshot(self) -> dict:
        """JSON-safe copy cached on the device row for live views."""
        data = {
            name: getattr(self, name)
            for name in self.__dataclass_fields__
            if name not in {"device_code", "device_ts"}
        }
        data["device_ts"] = self.device_ts.isoformat() if self.device_ts else None
        return data


def parse_telemetry(device_code: str, raw) -> TelemetryPayload:
    code = _check_identity(device_code, raw)
    imu, vit, gps, rad, bat = (_section(raw, key) for key in ("imu", "vit", "gps", "rad", "bat"))

    posture = imu.get("posture")
    gps_fix = _flag(gps.get("fix"))
    has_position = gps_fix is not False
    return TelemetryPayload(
        device_code=code,
        seq=_int(raw.get("seq"), 0, 2**31 - 1),
        uptime_s=_int(raw.get("up"), 0, 2**31 - 1),
        device_ts=_epoch(raw.get("ts")),
        vest_temp_c=_num(raw.get("vest_t"), -40, 125),
        tilt_deg=_num(imu.get("tilt"), 0, 180),
        posture=posture if posture in values(Posture) else None,
        activity_g=_num(imu.get("act"), 0, 16),
        peak_g=_num(imu.get("peak_g"), 0, 16),
        still_s=_int(imu.get("still_s"), 0, 10**7),
        rssi=_int(raw.get("rssi"), -127, 0),
        alert_mask=_int(raw.get("alerts"), 0, 2**31 - 1) or 0,
        prealert=bool(_flag(raw.get("pre"))),
        heart_rate=_int(vit.get("hr"), 20, 250),
        spo2=_int(vit.get("spo2"), 50, 100),
        skin_temp_c=_num(vit.get("skin_t"), -10, 60),
        sensor_contact=_flag(vit.get("contact")),
        lat=_num(gps.get("lat"), -90, 90) if has_position else None,
        lng=_num(gps.get("lon"), -180, 180) if has_position else None,
        gps_fix=gps_fix,
        gps_sats=_int(gps.get("sat"), 0, 64),
        radiation_usvh=_num(rad.get("usvh"), 0, 100_000),
        radiation_cpm=_int(rad.get("cpm"), 0, 10**8),
        radiation_dose_usv=_num(rad.get("dose"), 0, 10**9),
        battery_pct=_int(bat.get("pct"), 0, 100),
        battery_v=_num(bat.get("v"), 0, 60),
    )


# ── alerts ───────────────────────────────────────────────────
_ALERT_CONTEXT_KEYS = {"tilt": (0, 180), "vest_t": (-40, 125), "hr": (20, 250), "spo2": (50, 100),
                       "lat": (-90, 90), "lon": (-180, 180), "usvh": (0, 100_000)}


@dataclass(frozen=True)
class AlertPayload:
    device_code: str
    alert_type: str
    severity: Severity
    state: DeviceAlertState
    value: float | None = None
    seq: int | None = None
    uptime_s: int | None = None
    device_ts: datetime | None = None
    context: dict = field(default_factory=dict)


def parse_alert(device_code: str, raw) -> AlertPayload:
    code = _check_identity(device_code, raw)
    alert_type = str(raw.get("type", "")).strip().upper()
    info = ALERT_CATALOG.get(alert_type)
    if info is None or info.source != AlertSource.DEVICE:
        raise PayloadError(f"unknown device alert type {alert_type!r}")
    state = str(raw.get("state", "")).strip().lower()
    if state not in values(DeviceAlertState):
        raise PayloadError(f"unknown alert state {state!r}")
    context = {}
    for key, (lo, hi) in _ALERT_CONTEXT_KEYS.items():
        number = _num(raw.get(key), lo, hi)
        if number is not None:
            context[key] = number
    return AlertPayload(
        device_code=code,
        alert_type=alert_type,
        severity=Severity.from_device_code(raw.get("sev")),
        state=DeviceAlertState(state),
        value=_num(raw.get("val"), -1e6, 1e6),
        seq=_int(raw.get("seq"), 0, 2**31 - 1),
        uptime_s=_int(raw.get("up"), 0, 2**31 - 1),
        device_ts=_epoch(raw.get("ts")),
        context=context,
    )


# ── status (retained; Last Will sets online=false) ───────────
@dataclass(frozen=True)
class StatusPayload:
    device_code: str
    online: bool
    firmware_version: str | None = None
    ip_address: str | None = None
    rssi: int | None = None
    sensors: dict | None = None
    interval_s: int | None = None
    buzzer: bool | None = None
    simulated: bool | None = None


def _ip(value) -> str | None:
    text = _text(value, 45)
    if not text:
        return None
    try:
        return str(ipaddress.ip_address(text))
    except ValueError:
        return None


def _sensors(value) -> dict | None:
    if not isinstance(value, dict):
        return None
    cleaned = {}
    for key, item in list(value.items())[:16]:
        name = _text(key, 16)
        if not name:
            continue
        if isinstance(item, bool):
            cleaned[name] = item
        elif isinstance(item, str):
            cleaned[name] = item.strip()[:24]
    return cleaned


def parse_status(device_code: str, raw) -> StatusPayload:
    code = _check_identity(device_code, raw)
    online = _flag(raw.get("online"))
    if online is None:
        raise PayloadError("status.online must be a boolean")
    return StatusPayload(
        device_code=code,
        online=online,
        firmware_version=_text(raw.get("fw"), 20),
        ip_address=_ip(raw.get("ip")),
        rssi=_int(raw.get("rssi"), -127, 0),
        sensors=_sensors(raw.get("sensors")),
        interval_s=_int(raw.get("interval_s"), 1, 3600),
        buzzer=_flag(raw.get("buzzer")),
        simulated=_flag(raw.get("sim")),
    )


# ── command responses ────────────────────────────────────────
@dataclass(frozen=True)
class CommandResponsePayload:
    device_code: str
    command: str
    ok: bool
    info: str | None = None
    correlation_id: str | None = None


def parse_command_response(device_code: str, raw) -> CommandResponsePayload:
    code = _check_identity(device_code, raw)
    command = _text(raw.get("cmd"), 16)
    ok = _flag(raw.get("ok"))
    if not command or ok is None:
        raise PayloadError("response needs 'cmd' and boolean 'ok'")
    return CommandResponsePayload(
        device_code=code,
        command=command.lower(),
        ok=ok,
        info=_text(raw.get("info"), 255),
        correlation_id=_text(raw.get("cid"), 16),
    )
