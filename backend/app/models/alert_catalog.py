"""Catalog of every alert type the system understands.

Device alert types follow the firmware's ``alerts`` bitmask order exactly
(bit 0 = SOS ... bit 15 = VEST_TEMP_HIGH), so the backend stays compatible
with both the Phase-1 firmware (IMU only) and the full-sensor firmware.
Analysis alert types are raised server-side by the AI analysis layer.
"""
from dataclasses import dataclass

from app.models.enums import AlertSource


@dataclass(frozen=True)
class AlertTypeInfo:
    code: str
    category: str        # sos | motion | vitals | environment | radiation | system | analysis
    base_priority: int   # 0..100 — used by the alert prioritisation model
    source: AlertSource
    phase: int           # hardware phase that can produce it (1 = available today)


DEVICE_ALERT_BITS: tuple[str, ...] = (
    "SOS", "FALL", "IMPACT", "MAN_DOWN", "NO_MOTION",
    "HR_HIGH", "HR_LOW", "SPO2_LOW", "SKIN_TEMP_HIGH", "SKIN_TEMP_LOW",
    "RAD_RATE", "RAD_DOSE", "SENSOR_OFF", "BATTERY_LOW", "GPS_LOST",
    "VEST_TEMP_HIGH",
)

_D, _A = AlertSource.DEVICE, AlertSource.ANALYSIS

ALERT_CATALOG: dict[str, AlertTypeInfo] = {
    info.code: info
    for info in (
        AlertTypeInfo("SOS", "sos", 100, _D, 1),
        AlertTypeInfo("MAN_DOWN", "motion", 95, _D, 1),
        AlertTypeInfo("FALL", "motion", 90, _D, 1),
        AlertTypeInfo("IMPACT", "motion", 75, _D, 1),
        AlertTypeInfo("NO_MOTION", "motion", 60, _D, 1),
        AlertTypeInfo("VEST_TEMP_HIGH", "environment", 65, _D, 1),
        AlertTypeInfo("HR_HIGH", "vitals", 70, _D, 2),
        AlertTypeInfo("HR_LOW", "vitals", 78, _D, 2),
        AlertTypeInfo("SPO2_LOW", "vitals", 82, _D, 2),
        AlertTypeInfo("SKIN_TEMP_HIGH", "vitals", 62, _D, 2),
        AlertTypeInfo("SKIN_TEMP_LOW", "vitals", 50, _D, 2),
        AlertTypeInfo("SENSOR_OFF", "system", 30, _D, 2),
        AlertTypeInfo("BATTERY_LOW", "system", 35, _D, 2),
        AlertTypeInfo("GPS_LOST", "system", 25, _D, 3),
        AlertTypeInfo("RAD_RATE", "radiation", 88, _D, 4),
        AlertTypeInfo("RAD_DOSE", "radiation", 72, _D, 4),
        AlertTypeInfo("CONTACT_LOST", "system", 70, _A, 1),
        AlertTypeInfo("TEMP_ANOMALY", "analysis", 45, _A, 1),
        AlertTypeInfo("ACTIVITY_ANOMALY", "analysis", 40, _A, 1),
        AlertTypeInfo("HR_ANOMALY", "analysis", 55, _A, 2),
        AlertTypeInfo("SPO2_ANOMALY", "analysis", 60, _A, 2),
        AlertTypeInfo("SKIN_TEMP_ANOMALY", "analysis", 45, _A, 2),
        AlertTypeInfo("RADIATION_ANOMALY", "analysis", 65, _A, 4),
    )
}


def is_known_alert_type(code: str) -> bool:
    return code in ALERT_CATALOG


def decode_alert_mask(mask: int | None) -> list[str]:
    """Turn the firmware ``alerts`` bitmask into alert type codes."""
    if not mask:
        return []
    return [code for bit, code in enumerate(DEVICE_ALERT_BITS) if mask & (1 << bit)]
