"""Shared fixtures. Tests run on in-memory SQLite (portable column types make
the models behave like Postgres) and a recording command publisher, so no
Supabase project or MQTT broker is needed to run the suite."""
from datetime import timedelta

import pytest

from app import create_app
from app.config import TestingConfig
from app.extensions import db
from app.models.base_model import utcnow
from app.services.facade import get_facade
from app.services.providers import RecordingCommandPublisher

PASSWORDS = {"admin": "admin-pass-123", "operator": "operator-pass-123", "viewer": "viewer-pass-123"}


@pytest.fixture
def app():
    app = create_app(TestingConfig)
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()
        db.engine.dispose()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def facade(app):
    return get_facade()


@pytest.fixture
def publisher(facade):
    recorder = RecordingCommandPublisher(succeed=True)
    facade.publisher = recorder
    return recorder


@pytest.fixture
def accounts(facade):
    return {
        role: facade.create_operator(email=f"{role}@sta.test", full_name=f"{role.title()} User", role=role,
                                     password=password)
        for role, password in PASSWORDS.items()
    }


def login(client, role: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"{role}@sta.test", "password": PASSWORDS[role]})
    assert response.status_code == 200, response.get_json()
    return {"Authorization": f"Bearer {response.get_json()['access_token']}"}


@pytest.fixture
def headers(client, accounts):
    return {role: login(client, role) for role in PASSWORDS}


@pytest.fixture
def vest(facade):
    person = facade.create_personnel({"callsign": "ALPHA-01", "full_name": "Field Member 01",
                                      "zone": "Central Riyadh", "post_lat": 24.7136, "post_lng": 46.6753})
    return facade.register_device({"device_code": "STA-01", "personnel_id": person["personnel_id"]})


def telemetry(seq=1, up=100, vest_t=31.0, tilt=3, act=0.01, peak=1.0, posture="upright", still=0,
              alerts=0, pre=False, **extra) -> dict:
    """A message shaped exactly like the firmware's sta/v1/<id>/telemetry payload."""
    message = {"id": "STA-01", "seq": seq, "up": up, "vest_t": vest_t,
               "imu": {"peak_g": peak, "tilt": tilt, "act": act, "posture": posture, "still_s": still},
               "rssi": -60, "alerts": alerts, "pre": pre}
    message.update(extra)
    return message


def alert_msg(alert_type, state, sev, seq, up, val=1.0) -> dict:
    return {"id": "STA-01", "seq": seq, "type": alert_type, "sev": sev, "state": state, "val": val, "up": up,
            "tilt": 70, "vest_t": 31.5}


@pytest.fixture
def clock():
    """Deterministic, increasing timestamps close to 'now'."""
    start = utcnow() - timedelta(minutes=5)

    def at(seconds: float):
        return start + timedelta(seconds=seconds)

    return at
