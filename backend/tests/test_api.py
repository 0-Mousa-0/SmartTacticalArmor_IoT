"""REST API: authentication, role-based access and the main endpoints."""
from tests.conftest import alert_msg, login, telemetry

API = "/api/v1"


def test_health_is_public(client):
    response = client.get(f"{API}/health")
    assert response.status_code == 200
    assert response.get_json()["database"] == "ok"


def test_login_and_profile(client, accounts):
    response = client.post(f"{API}/auth/login", json={"email": "ADMIN@sta.test", "password": "admin-pass-123"})
    assert response.status_code == 200
    token = response.get_json()["access_token"]
    me = client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.get_json()["role"] == "admin"


def test_wrong_password_and_lockout(client, accounts):
    for _ in range(5):
        bad = client.post(f"{API}/auth/login", json={"email": "viewer@sta.test", "password": "nope-nope"})
        assert bad.status_code == 401
    locked = client.post(f"{API}/auth/login", json={"email": "viewer@sta.test", "password": "viewer-pass-123"})
    assert locked.status_code == 429


def test_requests_without_token_are_rejected(client):
    assert client.get(f"{API}/devices").status_code == 401
    assert client.get(f"{API}/devices", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_role_based_access(client, headers, vest, publisher):
    device_url = f"{API}/devices/{vest['device_id']}/commands"
    assert client.post(device_url, json={"command_type": "ping"}, headers=headers["viewer"]).status_code == 403
    assert client.post(device_url, json={"command_type": "ping"}, headers=headers["operator"]).status_code == 201
    new_device = {"device_code": "STA-02", "is_simulated": True}
    assert client.post(f"{API}/devices", json=new_device, headers=headers["operator"]).status_code == 403
    assert client.post(f"{API}/devices", json=new_device, headers=headers["admin"]).status_code == 201
    assert client.get(f"{API}/operators", headers=headers["operator"]).status_code == 403


def test_device_registration_validation(client, headers):
    bad = client.post(f"{API}/devices", json={"device_code": "STA 01!"}, headers=headers["admin"])
    assert bad.status_code == 400
    ok = client.post(f"{API}/devices", json={"device_code": "sta-09"}, headers=headers["admin"])
    assert ok.get_json()["device_code"] == "STA-09"
    dup = client.post(f"{API}/devices", json={"device_code": "STA-09"}, headers=headers["admin"])
    assert dup.status_code == 409


def test_alert_flow_over_http(client, headers, facade, vest, publisher):
    facade.ingest_telemetry("STA-01", telemetry())
    facade.ingest_device_alert("STA-01", alert_msg("SOS", "event", 3, seq=1, up=101))
    listing = client.get(f"{API}/alerts?scope=open", headers=headers["viewer"]).get_json()
    assert listing["total"] == 1
    alert_id = listing["items"][0]["alert_id"]

    acked = client.post(f"{API}/alerts/{alert_id}/acknowledge", json={"note": "On my way"},
                        headers=headers["operator"])
    assert acked.status_code == 200 and acked.get_json()["status"] == "acknowledged"
    resolved = client.post(f"{API}/alerts/{alert_id}/resolve", json={"note": "Safe"}, headers=headers["operator"])
    assert resolved.get_json()["status"] == "resolved"
    assert client.get(f"{API}/alerts/summary", headers=headers["viewer"]).get_json()["open_total"] == 0


def test_dashboard_read_models(client, headers, facade, vest):
    facade.ingest_telemetry("STA-01", telemetry())
    overview = client.get(f"{API}/overview", headers=headers["viewer"]).get_json()
    assert overview["kpis"]["units_total"] == 1
    history = client.get(f"{API}/devices/{vest['device_id']}/telemetry?minutes=10", headers=headers["viewer"])
    assert len(history.get_json()["points"]) == 1
    analysis = client.get(f"{API}/analysis", headers=headers["viewer"]).get_json()
    assert analysis["model"]["anomaly_detection"]["z_threshold"] == 3.0
    estimate = client.post(f"{API}/armor/shielding/estimate", headers=headers["viewer"], json={
        "material": "bi2o3", "beam": "am241", "concentration_wt_pct": 8.333, "thickness_cm": 0.5})
    assert estimate.status_code == 200 and estimate.get_json()["attenuation_pct"] > 80


def test_personnel_crud_and_assignment(client, headers):
    created = client.post(f"{API}/personnel", headers=headers["admin"],
                          json={"callsign": "bravo-1", "full_name": "Field Member B1", "blood_type": "o+"})
    assert created.status_code == 201 and created.get_json()["callsign"] == "BRAVO-1"
    person_id = created.get_json()["personnel_id"]
    device = client.post(f"{API}/devices", headers=headers["admin"],
                         json={"device_code": "STA-05", "personnel_id": person_id}).get_json()
    assert device["personnel"]["callsign"] == "BRAVO-1"
    other = client.post(f"{API}/devices", headers=headers["admin"],
                        json={"device_code": "STA-06", "personnel_id": person_id})
    assert other.status_code == 409  # one vest per wearer
    client.delete(f"{API}/personnel/{person_id}", headers=headers["admin"])
    assert client.get(f"{API}/devices/{device['device_id']}", headers=headers["admin"]).get_json()["personnel"] is None


def test_cannot_lock_out_the_last_admin(client, headers, accounts):
    admin_id = accounts["admin"]["operator_id"]
    response = client.patch(f"{API}/operators/{admin_id}", json={"role": "viewer"}, headers=headers["admin"])
    assert response.status_code == 409


def test_disabled_operator_loses_access_immediately(client, headers, accounts):
    viewer_id = accounts["viewer"]["operator_id"]
    client.patch(f"{API}/operators/{viewer_id}", json={"is_active": False}, headers=headers["admin"])
    assert client.get(f"{API}/devices", headers=headers["viewer"]).status_code == 401


def test_change_password(client, headers):
    response = client.post(f"{API}/auth/change-password", headers=headers["operator"],
                           json={"current_password": "operator-pass-123", "new_password": "new-secret-456"})
    assert response.status_code == 200
    relogin = client.post(f"{API}/auth/login", json={"email": "operator@sta.test", "password": "new-secret-456"})
    assert relogin.status_code == 200
    assert login is not None
