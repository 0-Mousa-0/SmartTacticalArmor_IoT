"""The anti-corruption layer: firmware JSON -> validated domain payloads."""
import pytest

from app.messaging.topics import parse_topic, subscriptions
from app.models.alert_catalog import decode_alert_mask
from app.models.enums import DeviceAlertState, Severity
from app.services.ingest import (
    PayloadError,
    parse_alert,
    parse_command_response,
    parse_status,
    parse_telemetry,
)

FIRMWARE_TELEMETRY = {
    "id": "STA-01", "seq": 42, "up": 3600, "ts": 1_800_000_000, "vest_t": 33.4,
    "imu": {"peak_g": 1.21, "tilt": 12, "act": 0.031, "posture": "upright", "still_s": 4},
    "rssi": -58, "alerts": 0, "pre": False,
}


def test_parses_phase1_firmware_telemetry():
    p = parse_telemetry("sta-01", FIRMWARE_TELEMETRY)
    assert p.device_code == "STA-01"
    assert (p.vest_temp_c, p.tilt_deg, p.activity_g, p.peak_g, p.still_s) == (33.4, 12, 0.031, 1.21, 4)
    assert p.posture == "upright"
    assert p.device_ts is not None and p.device_ts.year == 2027
    assert p.heart_rate is None and p.lat is None  # Phase 2+ sensors not fitted
    assert p.metrics() == {"vest_temp_c": 33.4, "activity_g": 0.031}


def test_parses_full_sensor_firmware_sections():
    message = {**FIRMWARE_TELEMETRY,
               "vit": {"contact": True, "hr": 82, "spo2": 97, "skin_t": 34.1},
               "gps": {"fix": True, "lat": 24.71, "lon": 46.67, "sat": 7},
               "rad": {"cpm": 20, "usvh": 0.162, "dose": 1.2}, "bat": {"v": 7.9, "pct": 74}}
    p = parse_telemetry("STA-01", message)
    assert (p.heart_rate, p.spo2, p.skin_temp_c) == (82, 97, 34.1)
    assert (p.lat, p.lng, p.gps_sats) == (24.71, 46.67, 7)
    assert (p.radiation_usvh, p.battery_pct) == (0.162, 74)


def test_out_of_range_values_are_dropped_not_fatal():
    message = {**FIRMWARE_TELEMETRY, "vest_t": 999, "imu": {"tilt": -5, "act": "x", "posture": "flying"}}
    p = parse_telemetry("STA-01", message)
    assert p.vest_temp_c is None and p.tilt_deg is None and p.activity_g is None and p.posture is None


def test_payload_id_must_match_topic():
    with pytest.raises(PayloadError):
        parse_telemetry("STA-02", FIRMWARE_TELEMETRY)


def test_gps_without_fix_has_no_position():
    p = parse_telemetry("STA-01", {**FIRMWARE_TELEMETRY, "gps": {"fix": False, "lat": 1, "lon": 2}})
    assert p.lat is None and p.lng is None


def test_alert_parsing():
    p = parse_alert("STA-01", {"id": "STA-01", "seq": 3, "type": "fall", "sev": 3, "state": "event",
                               "val": 3.4, "up": 120, "tilt": 72})
    assert (p.alert_type, p.severity, p.state) == ("FALL", Severity.CRITICAL, DeviceAlertState.EVENT)
    assert p.context == {"tilt": 72}


@pytest.mark.parametrize("bad", [
    {"type": "UNKNOWN", "state": "event", "sev": 2},
    {"type": "FALL", "state": "exploded", "sev": 2},
    {"type": "CONTACT_LOST", "state": "event", "sev": 2},  # analysis-only type
])
def test_alert_rejects_bad_type_or_state(bad):
    with pytest.raises(PayloadError):
        parse_alert("STA-01", bad)


def test_status_and_last_will():
    online = parse_status("STA-01", {"id": "STA-01", "online": True, "fw": "2.0.0", "ip": "192.168.1.20",
                                     "rssi": -61, "sensors": {"imu": "MPU-6050", "ppg": False},
                                     "interval_s": 5})
    assert online.online and online.firmware_version == "2.0.0" and online.sensors["imu"] == "MPU-6050"
    assert parse_status("STA-01", {"id": "STA-01", "online": False}).online is False
    with pytest.raises(PayloadError):
        parse_status("STA-01", {"id": "STA-01"})


def test_command_response():
    p = parse_command_response("STA-01", {"id": "STA-01", "cmd": "PING", "ok": True, "info": "pong",
                                          "cid": "a1b2c3d4"})
    assert (p.command, p.ok, p.correlation_id) == ("ping", True, "a1b2c3d4")


def test_alert_mask_decoding_matches_firmware_bit_order():
    assert decode_alert_mask(0b1) == ["SOS"]
    assert decode_alert_mask((1 << 1) | (1 << 15)) == ["FALL", "VEST_TEMP_HIGH"]


def test_topics():
    assert parse_topic("sta/v1/STA-01/telemetry", "sta/v1").device_code == "STA-01"
    assert parse_topic("sta/v1/STA-01/cmd", "sta/v1") is None
    assert parse_topic("other/STA-01/telemetry", "sta/v1") is None
    assert ("sta/v1/+/alert", 1) in subscriptions("sta/v1")
