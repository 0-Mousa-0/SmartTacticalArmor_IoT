"""End-to-end checker: drives the REST API while the simulator publishes over MQTT.

Procedure and expected output: tools/e2e/README.md
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = os.getenv("E2E_API", "http://127.0.0.1:5055/api/v1")
ADMIN = (os.getenv("E2E_ADMIN_EMAIL", "admin@sta.local"), os.getenv("E2E_ADMIN_PASSWORD", "Admin-Demo-2026"))
VIEWER = (os.getenv("E2E_VIEWER_EMAIL", "viewer@sta.local"), os.getenv("E2E_VIEWER_PASSWORD", "Viewer-Demo-2026"))
TOKEN = None
FAILS = []


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token or TOKEN:
        req.add_header("Authorization", f"Bearer {token or TOKEN}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"null")


def check(ok, label):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}", flush=True)
    if not ok:
        FAILS.append(label)


def wait_until(predicate, timeout, label, step=1.0):
    end = time.time() + timeout
    while time.time() < end:
        value = predicate()
        if value:
            return value
        time.sleep(step)
    check(False, f"timeout waiting for: {label}")
    return None


for _ in range(60):
    try:
        status, health = call("GET", "/health")
        if status == 200 and health["mqtt"]["connected"]:
            break
    except Exception:  # noqa: BLE001
        pass
    time.sleep(1)
print("health:", health, flush=True)
check(health["mqtt"]["connected"], "backend connected to the MQTT broker")

status, session = call("POST", "/auth/login", {"email": ADMIN[0], "password": ADMIN[1]})
check(status == 200, "bootstrap admin can sign in")
TOKEN = session["access_token"]

devices = {d["device_code"]: d for d in call("GET", "/devices")[1]}
online = wait_until(lambda: all(d["connection"] == "online" for d in call("GET", "/devices")[1]) and True, 40,
                    "all six vests online")
check(bool(online), "all six vests report online through MQTT")

status, cmd = call("POST", f"/devices/{devices['STA-02']['device_id']}/commands", {"command_type": "ping"})
check(status == 201 and cmd["status"] == "sent", "ping published to STA-02")
acked = wait_until(lambda: next((c for c in call("GET", f"/devices/{devices['STA-02']['device_id']}/commands")[1]
                                 if c["command_id"] == cmd["command_id"] and c["status"] == "acknowledged"), None),
                   10, "ping acknowledged")
check(bool(acked) and acked["response_info"] == "pong", "vest answered 'pong' with the correlation id")

status, cmd = call("POST", f"/devices/{devices['STA-06']['device_id']}/commands",
                   {"command_type": "interval", "params": {"sec": 2}})
wait_until(lambda: call("GET", f"/devices/{devices['STA-06']['device_id']}")[1]["telemetry_interval_s"] == 2, 10,
           "interval applied")
check(call("GET", f"/devices/{devices['STA-06']['device_id']}")[1]["telemetry_interval_s"] == 2,
      "interval command changed the vest report interval to 2 s")

status, _ = call("POST", "/auth/login", {"email": VIEWER[0], "password": VIEWER[1]})
viewer = _["access_token"]
status, _ = call("POST", f"/devices/{devices['STA-02']['device_id']}/commands", {"command_type": "evac"}, token=viewer)
check(status == 403, "viewer role cannot send commands (403)")

print("waiting for the scripted demo events (fall, anomaly, heat, sos, offline)...", flush=True)


def open_types():
    return {a["alert_type"]: a for a in call("GET", "/alerts?scope=open&limit=200")[1]["items"]}


fall = wait_until(lambda: (lambda t: t.get("FALL") if t.get("FALL", {}).get("severity") == "critical" else None)(open_types()),
                  90, "FALL escalated to critical")
check(bool(fall) and fall["device_code"] == "STA-02", "STA-02 fall: pending -> critical after 10 s without answer")
if fall:
    status, acked = call("POST", f"/alerts/{fall['alert_id']}/acknowledge", {"note": "Medic dispatched"})
    check(status == 200 and acked["status"] == "acknowledged" and acked["device_notified"] is True,
          "operator acknowledged the fall and the vest was notified")
    kinds = [e["kind"] for e in call("GET", f"/alerts/{fall['alert_id']}")[1]["events"]]
    check(kinds[:3] == ["pending", "escalated", "acknowledged"], f"fall timeline {kinds}")

anomaly = wait_until(lambda: next(iter(call("GET", "/alerts?scope=all&type=TEMP_ANOMALY")[1]["items"]), None), 90, "AI temperature anomaly")
check(bool(anomaly) and anomaly["source"] == "analysis" and anomaly["device_code"] == "STA-03",
      "AI analysis flagged STA-03's abnormal temperature rise (below the vest's own threshold)")

heat = wait_until(lambda: open_types().get("VEST_TEMP_HIGH"), 90, "vest temperature alert")
check(bool(heat) and heat["device_code"] == "STA-04", "STA-04 heat condition alert raised by the vest")

sos = wait_until(lambda: open_types().get("SOS"), 90, "SOS")
check(bool(sos) and sos["priority"] >= 95, "SOS ranked at the top of the priority queue")

lost = wait_until(lambda: open_types().get("CONTACT_LOST"), 90, "contact lost")
check(bool(lost) and lost["device_code"] == "STA-05", "STA-05 dropped off-air -> Last Will + CONTACT_LOST alert")

overview = call("GET", "/overview")[1]
print("KPIs:", json.dumps(overview["kpis"]), flush=True)
top = overview["units"][[u["device_id"] for u in overview["units"]].index(overview["priority_queue"][0])]
print("Priority #1:", top["device_code"], top["risk"], flush=True)
check(overview["kpis"]["alerts_critical"] >= 2, "overview counts the critical incidents")

restored = wait_until(lambda: "CONTACT_LOST" not in open_types(), 60, "contact restored", step=2)
check(restored is not None, "contact-lost alert cleared automatically when STA-05 came back")

analysis = call("GET", "/analysis")[1]
sta03 = next(u for u in analysis["units"] if u["device_code"] == "STA-03")
temp = next(b for b in sta03["baselines"] if b["metric"] == "vest_temp_c")
print("STA-03 baseline:", temp, flush=True)
check(temp["samples"] >= 20, "per-wearer baseline learned from live telemetry")

history = call("GET", f"/devices/{devices['STA-01']['device_id']}/telemetry?minutes=10")[1]
check(len(history["points"]) >= 5, f"telemetry history stored ({len(history['points'])} points)")

print("\nRESULT:", "ALL CHECKS PASSED" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}", flush=True)
sys.exit(1 if FAILS else 0)
