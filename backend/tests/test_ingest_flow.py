"""End-to-end business flows through the facade (vest messages in, state out)."""
import json

import pytest

from app.extensions import db
from app.messaging.dispatcher import MessageDispatcher
from app.models import Alert, TelemetryReading
from app.models.base_model import utcnow
from app.services.facade import FacadeError
from tests.conftest import alert_msg, telemetry


def test_status_then_telemetry_brings_vest_online(facade, vest):
    facade.ingest_status("STA-01", {"id": "STA-01", "online": True, "fw": "2.0.0",
                                    "sensors": {"imu": "MPU-6050"}, "interval_s": 5})
    result = facade.ingest_telemetry("STA-01", telemetry(vest_t=32.5))
    assert result["stored"] is True
    view = facade.get_device(vest["device_id"])
    assert view["connection"] == "online"
    assert view["firmware_version"] == "2.0.0"
    assert view["telemetry"]["vest_temp_c"] == 32.5
    assert view["position"] == {"lat": 24.7136, "lng": 46.6753, "source": "post"}
    assert view["risk"]["level"] == "normal"


def test_history_is_down_sampled(facade, vest, clock):
    facade.ingest_telemetry("STA-01", telemetry(seq=1), clock(0))
    facade.ingest_telemetry("STA-01", telemetry(seq=2), clock(1))     # too soon -> not stored
    facade.ingest_telemetry("STA-01", telemetry(seq=3), clock(6))
    facade.ingest_telemetry("STA-01", telemetry(seq=4, alerts=1), clock(7))  # alert picture changed -> stored
    assert db.session.query(TelemetryReading).count() == 3


def test_fall_lifecycle_pending_escalate_ack_resolve(facade, vest, publisher, accounts):
    operator_id = accounts["operator"]["operator_id"]
    facade.ingest_telemetry("STA-01", telemetry(up=100))
    pending = facade.ingest_device_alert("STA-01", alert_msg("FALL", "pending", 1, seq=1, up=110, val=3.2))
    assert pending["status"] == "pending"

    escalated = facade.ingest_device_alert("STA-01", alert_msg("FALL", "event", 3, seq=2, up=120, val=3.2))
    assert escalated["alert_id"] == pending["alert_id"]
    assert (escalated["status"], escalated["severity"]) == ("open", "critical")
    assert facade.get_device(vest["device_id"])["risk"]["level"] == "critical"

    acked = facade.acknowledge_alert(escalated["alert_id"], operator_id, note="Medic dispatched")
    assert acked["status"] == "acknowledged" and acked["device_notified"] is True
    device_code, message = publisher.sent[-1]
    assert device_code == "STA-01" and message["cmd"] == "ack" and message["type"] == "FALL"

    resolved = facade.resolve_alert(escalated["alert_id"], operator_id, note="Wearer evacuated")
    assert resolved["status"] == "resolved"
    assert [e["kind"] for e in resolved["events"]] == ["pending", "escalated", "acknowledged", "resolved"]
    with pytest.raises(FacadeError):
        facade.resolve_alert(escalated["alert_id"], operator_id)


def test_wearer_cancels_prealert(facade, vest):
    first = facade.ingest_device_alert("STA-01", alert_msg("MAN_DOWN", "pending", 1, seq=1, up=50))
    cancelled = facade.ingest_device_alert("STA-01", alert_msg("MAN_DOWN", "cancelled", 1, seq=2, up=55))
    assert cancelled["alert_id"] == first["alert_id"]
    assert cancelled["status"] == "cancelled" and cancelled["is_open"] is False


def test_condition_alert_clears_itself(facade, vest):
    active = facade.ingest_device_alert("STA-01", alert_msg("VEST_TEMP_HIGH", "active", 2, seq=1, up=10, val=47))
    worse = facade.ingest_device_alert("STA-01", alert_msg("VEST_TEMP_HIGH", "active", 3, seq=2, up=20, val=56))
    assert worse["alert_id"] == active["alert_id"] and worse["severity"] == "critical"
    cleared = facade.ingest_device_alert("STA-01", alert_msg("VEST_TEMP_HIGH", "cleared", 1, seq=3, up=30))
    assert cleared["status"] == "cleared"


def test_duplicate_alert_delivery_is_idempotent(facade, vest):
    message = alert_msg("SOS", "event", 3, seq=7, up=99)
    facade.ingest_device_alert("STA-01", message)
    assert facade.ingest_device_alert("STA-01", message) == {"duplicate": True}
    assert db.session.query(Alert).count() == 1


def test_retained_status_does_not_fake_presence(facade, vest):
    facade.ingest_status("STA-01", {"id": "STA-01", "online": True}, retained=True)
    assert facade.get_device(vest["device_id"])["connection"] == "never"


def test_last_will_marks_vest_offline(facade, vest):
    facade.ingest_telemetry("STA-01", telemetry())
    facade.ingest_status("STA-01", {"id": "STA-01", "online": False})
    view = facade.get_device(vest["device_id"])
    assert view["connection"] == "offline"
    assert any(f["code"] == "contact_lost" for f in view["risk"]["factors"])


def test_ai_detects_persistent_temperature_anomaly_and_clears_it(facade, vest, clock):
    stable = [31.0, 31.1, 30.9, 31.0, 31.05, 30.95, 31.0, 31.1, 30.9, 31.0, 31.0, 31.05]
    t = 0
    for i, value in enumerate(stable):
        facade.ingest_telemetry("STA-01", telemetry(seq=i, vest_t=value), clock(t))
        t += 5
    for value in (34.0, 34.2, 34.4):
        facade.ingest_telemetry("STA-01", telemetry(vest_t=value), clock(t))
        t += 5
    alert = db.session.query(Alert).filter_by(alert_type="TEMP_ANOMALY").one()
    assert (alert.source, alert.status, alert.severity) == ("analysis", "open", "warning")
    assert alert.context["z"] > 3

    facade.ingest_telemetry("STA-01", telemetry(vest_t=31.0), clock(t))
    db.session.refresh(alert)
    assert alert.status == "cleared"


def test_contact_lost_raised_by_housekeeping_and_cleared_on_return(facade, vest, clock):
    facade.ingest_telemetry("STA-01", telemetry(), clock(0))
    summary = facade.run_housekeeping(now=clock(120))
    assert summary["contact_lost"] == 1
    alert = db.session.query(Alert).filter_by(alert_type="CONTACT_LOST").one()
    assert alert.status == "open"
    facade.ingest_telemetry("STA-01", telemetry(), clock(130))
    db.session.refresh(alert)
    assert alert.status == "cleared"


def test_unknown_device_is_rejected_unless_auto_register(app, facade):
    with pytest.raises(FacadeError) as error:
        facade.ingest_telemetry("STA-99", {"id": "STA-99", "vest_t": 30})
    assert error.value.status == 404
    app.config["DEVICE_AUTO_REGISTER"] = True
    facade.ingest_status("STA-99", {"id": "STA-99", "online": True, "sim": True})
    assert facade.devices.get_by_code("STA-99").is_simulated is True


def test_dispatcher_routes_mqtt_messages(facade, vest):
    dispatcher = MessageDispatcher("sta/v1")
    assert dispatcher.dispatch("sta/v1/STA-01/telemetry", json.dumps(telemetry()).encode()) == "ok"
    assert dispatcher.dispatch("sta/v1/STA-01/telemetry", b"{not json") == "invalid"
    assert dispatcher.dispatch("sta/v1/STA-77/telemetry", b'{"id":"STA-77"}') == "skipped"
    assert dispatcher.dispatch("sta/v1/STA-01/alert", b'{"type":"NOPE","state":"event"}') == "rejected"
    assert dispatcher.dispatch("elsewhere/STA-01/telemetry", b"{}") == "ignored"


def test_overview_kpis(facade, vest):
    facade.ingest_telemetry("STA-01", telemetry(), utcnow())
    facade.ingest_device_alert("STA-01", alert_msg("SOS", "event", 3, seq=1, up=101))
    overview = facade.get_overview()
    assert overview["kpis"]["units_online"] == 1
    assert overview["kpis"]["alerts_critical"] == 1
    assert overview["priority_queue"] == [vest["device_id"]]
    assert overview["alerts"][0]["alert_type"] == "SOS"
