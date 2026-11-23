"""Public-access mode (PUBLIC_ACCESS_ROLE): the dashboard works without signing in."""
import pytest

from app import create_app
from app.config import TestingConfig
from tests.conftest import alert_msg, telemetry

API = "/api/v1"


@pytest.fixture
def public(app):
    """Switch the running test app to public access with the given role."""

    def enable(role: str) -> None:
        app.config["PUBLIC_ACCESS_ROLE"] = role

    return enable


def test_sign_in_is_required_by_default(client):
    assert client.get(f"{API}/overview").status_code == 401
    assert client.get(f"{API}/auth/me").status_code == 401


def test_me_reports_the_public_profile(client, public):
    public("viewer")
    me = client.get(f"{API}/auth/me")
    assert me.status_code == 200
    profile = me.get_json()
    assert profile["public"] is True
    assert profile["role"] == "viewer"
    assert profile["operator_id"] is None


def test_public_viewer_can_read_but_not_act(client, public, facade, vest, publisher):
    public("viewer")
    facade.ingest_telemetry("STA-01", telemetry())
    assert client.get(f"{API}/overview").status_code == 200
    assert client.get(f"{API}/devices").status_code == 200
    command = client.post(f"{API}/devices/{vest['device_id']}/commands", json={"command_type": "ping"})
    assert command.status_code == 403


def test_public_operator_handles_alerts_and_commands(client, public, facade, vest, publisher):
    public("operator")
    facade.ingest_telemetry("STA-01", telemetry())
    facade.ingest_device_alert("STA-01", alert_msg("SOS", "event", 3, seq=1, up=101))
    alert_id = client.get(f"{API}/alerts?scope=open").get_json()["items"][0]["alert_id"]

    acked = client.post(f"{API}/alerts/{alert_id}/acknowledge", json={"note": "On my way"})
    assert acked.status_code == 200
    assert acked.get_json()["status"] == "acknowledged"
    assert acked.get_json()["acknowledged_by"] is None  # anonymous visitor

    command = client.post(f"{API}/devices/{vest['device_id']}/commands", json={"command_type": "ping"})
    assert command.status_code == 201
    assert client.post(f"{API}/devices", json={"device_code": "STA-02"}).status_code == 403


def test_public_admin_can_manage_the_fleet(client, public):
    public("admin")
    created = client.post(f"{API}/devices", json={"device_code": "STA-02", "is_simulated": True})
    assert created.status_code == 201


def test_a_token_still_decides_who_the_caller_is(client, public, headers):
    public("admin")
    # A signed-in viewer stays a viewer, and a bad token is rejected, not downgraded.
    assert client.post(f"{API}/devices", json={"device_code": "STA-02"}, headers=headers["viewer"]).status_code == 403
    assert client.get(f"{API}/overview", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_public_visitor_has_no_password_to_change(client, public):
    public("admin")
    response = client.post(f"{API}/auth/change-password",
                           json={"current_password": "whatever", "new_password": "new-password-123"})
    assert response.status_code == 403


def test_unknown_public_role_is_refused_at_startup():
    class Typo(TestingConfig):
        PUBLIC_ACCESS_ROLE = "admn"

    with pytest.raises(RuntimeError, match="PUBLIC_ACCESS_ROLE"):
        create_app(Typo)
