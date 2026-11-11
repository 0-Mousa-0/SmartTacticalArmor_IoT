#!/usr/bin/env python3
"""Virtual smart vests — demo units and end-to-end testing.

Each virtual vest is its own MQTT client and follows exactly the protocol of
the real firmware (docs/05-mqtt-protocol.md): retained status + Last Will,
telemetry every N seconds, alert state transitions, command responses with
the correlation id. The backend cannot tell them apart from hardware — the
dashboard labels them "Simulated" only because the fleet registry says so.

Usage:
    python vest_simulator.py                      # STA-02..STA-06, interactive
    python vest_simulator.py --demo               # scripted scenario for a presentation
    python vest_simulator.py --devices STA-02,STA-03 --interval 2

Console commands while running (type `help`):
    fall STA-03 | mandown STA-03 | sos STA-02 | heat STA-05 | fire STA-05 | cool STA-05
    still STA-04 | walk STA-04 | anomaly STA-04 | ok STA-03 | offline STA-06 | online STA-06
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import ssl
import sys
import threading
import time

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

try:  # optional .env support
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass

try:
    import certifi

    CA_FILE = certifi.where()
except ImportError:  # pragma: no cover
    CA_FILE = None

# Same bit order as the firmware's `alerts` bitmask (bit 0 = SOS).
ALERT_BITS = ["SOS", "FALL", "IMPACT", "MAN_DOWN", "NO_MOTION", "HR_HIGH", "HR_LOW", "SPO2_LOW",
              "SKIN_TEMP_HIGH", "SKIN_TEMP_LOW", "RAD_RATE", "RAD_DOSE", "SENSOR_OFF", "BATTERY_LOW",
              "GPS_LOST", "VEST_TEMP_HIGH"]
INFO, WARNING, CRITICAL = 1, 2, 3
PREALERT_S = 10
NO_MOTION_S = 60
FW_VERSION = "sim-2.0.0"


def log(code: str, text: str) -> None:
    print(f"{time.strftime('%H:%M:%S')}  [{code}] {text}", flush=True)


class VirtualVest:
    def __init__(self, code: str, args: argparse.Namespace, rng: random.Random):
        self.code = code
        self.args = args
        self.rng = rng
        self.interval = args.interval
        self.boot = time.monotonic()
        self.next_telemetry = time.monotonic() + rng.uniform(0.5, 2.0)
        self.telemetry_seq = 0
        self.alert_seq = 0
        self.lock = threading.RLock()

        self.base_temp = rng.uniform(30.8, 33.2)
        self.temp = self.base_temp
        self.target_temp = self.base_temp
        self.phase = rng.uniform(0, 2 * math.pi)
        self.posture = "upright"
        self.tilt = rng.uniform(2, 8)
        self.activity = rng.uniform(0.025, 0.06)
        self.activity_now, self.peak, self.tilt_now = self.activity, 1.0, self.tilt
        self.still_since: float | None = None
        self.buzzer = True
        self.conditions: dict[str, int] = {}          # active condition alerts -> severity
        self.prealert: tuple[str, float, float] | None = None  # (type, deadline, value)
        self.connected = False
        self.offline = False
        self.client = self._make_client()

    # ── MQTT plumbing ────────────────────────────────────────
    def topic(self, channel: str) -> str:
        return f"{self.args.topic_root}/{self.code}/{channel}"

    def _make_client(self) -> mqtt.Client:
        client = mqtt.Client(callback_api_version=CallbackAPIVersion.VERSION2, client_id=f"{self.code}-sim",
                             clean_session=True, protocol=mqtt.MQTTv311)
        if self.args.username:
            client.username_pw_set(self.args.username, self.args.password)
        if self.args.tls:
            client.tls_set(ca_certs=CA_FILE, cert_reqs=ssl.CERT_REQUIRED)
        client.will_set(self.topic("status"), json.dumps({"id": self.code, "online": False}), qos=1, retain=True)
        client.reconnect_delay_set(1, 30)
        client.on_connect = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.on_message = self._on_message
        return client

    def start(self) -> None:
        self.client.connect_async(self.args.host, self.args.port, keepalive=30)
        self.client.loop_start()

    def stop(self) -> None:
        self.client.disconnect()
        self.client.loop_stop()

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            log(self.code, f"connect refused: {reason_code}")
            return
        self.connected = True
        client.subscribe(self.topic("cmd"), qos=1)
        self.publish_status()
        log(self.code, "online")

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        self.connected = False

    def publish(self, channel: str, payload: dict, qos: int = 0, retain: bool = False) -> None:
        if self.connected and not self.offline:
            self.client.publish(self.topic(channel), json.dumps(payload, separators=(",", ":")), qos=qos, retain=retain)

    def uptime(self) -> int:
        return int(time.monotonic() - self.boot)

    def publish_status(self) -> None:
        suffix = int("".join(ch for ch in self.code if ch.isdigit())[-2:] or 0)
        self.publish("status", {
            "id": self.code, "online": True, "fw": FW_VERSION, "ip": f"10.0.0.{10 + suffix}",
            "rssi": -58, "sim": True, "interval_s": self.interval, "buzzer": self.buzzer,
            "sensors": {"imu": "MPU-6050 (sim)", "ppg": False, "temp": False, "gps": False, "geiger": False,
                        "bat": False},
        }, qos=1, retain=True)

    # ── alerts (same semantics as the firmware) ──────────────
    def raise_alert(self, alert_type: str, severity: int, state: str, value: float) -> None:
        self.alert_seq += 1
        self.publish("alert", {
            "id": self.code, "seq": self.alert_seq, "type": alert_type, "sev": severity, "state": state,
            "val": round(value, 2), "up": self.uptime(), "ts": int(time.time()),
            "tilt": int(self.tilt), "vest_t": round(self.temp, 1),
        }, qos=1)
        log(self.code, f"ALERT {alert_type} {state} sev={severity}")

    def update_condition(self, alert_type: str, severity: int | None, value: float) -> None:
        current = self.conditions.get(alert_type)
        if severity is None:
            if current is not None:
                del self.conditions[alert_type]
                self.raise_alert(alert_type, INFO, "cleared", value)
        elif current != severity:
            self.conditions[alert_type] = severity
            self.raise_alert(alert_type, severity, "active", value)

    def mask(self) -> int:
        active = set(self.conditions)
        if self.prealert:
            active.add(self.prealert[0])
        return sum(1 << ALERT_BITS.index(name) for name in active if name in ALERT_BITS)

    # ── scenarios ────────────────────────────────────────────
    def scenario(self, name: str) -> None:
        with self.lock:
            now = time.monotonic()
            if name in ("fall", "mandown"):
                if name == "mandown":
                    self.raise_alert("IMPACT", WARNING, "event", 7.8)
                self.posture, self.tilt, self.still_since = "lying", 78.0, now
                kind = "FALL" if name == "fall" else "MAN_DOWN"
                peak = 3.4 if name == "fall" else 7.8
                self.prealert = (kind, now + PREALERT_S, peak)
                self.raise_alert(kind, INFO, "pending", peak)
            elif name == "ok" and self.prealert:
                kind, _, value = self.prealert
                self.prealert = None
                self.raise_alert(kind, INFO, "cancelled", value)
                self.posture, self.tilt, self.still_since = "upright", 4.0, None
            elif name == "sos":
                self.raise_alert("SOS", CRITICAL, "event", 1)
            elif name == "impact":
                self.raise_alert("IMPACT", WARNING, "event", 7.2)
            elif name == "heat":
                self.target_temp = 49.0
            elif name == "fire":
                self.target_temp = 58.0
            elif name == "cool":
                self.target_temp = self.base_temp
            elif name == "anomaly":
                self.target_temp = self.base_temp + 3.6  # below the vest threshold — only the AI notices
            elif name == "still":
                self.posture, self.still_since = "upright", now
            elif name == "walk":
                self.posture, self.tilt, self.still_since = "upright", 4.0, None
                self.target_temp = self.base_temp
            elif name == "offline":
                self.offline = True
                sock = self.client.socket()
                if sock:
                    sock.close()  # ungraceful drop -> the broker publishes the Last Will
                log(self.code, "connection dropped (Last Will expected)")
            elif name == "online":
                self.offline = False
                self.client.reconnect()
            else:
                raise ValueError(name)

    # ── commands from the operations room ────────────────────
    def _on_message(self, client, userdata, message):
        try:
            payload = json.loads(message.payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return
        command, cid = str(payload.get("cmd", "")), payload.get("cid")
        ok, info = True, ""
        with self.lock:
            if command == "ping":
                info = "pong"
            elif command == "ack":
                info = str(payload.get("type", ""))
                log(self.code, f"ACK from ops room for {info or 'alert'} — wearer told help is coming")
            elif command == "evac":
                log(self.code, "EVACUATE signal received")
            elif command == "stop":
                info = "silenced"
            elif command == "interval":
                seconds = int(payload.get("sec", 0) or 0)
                if 1 <= seconds <= 60:
                    self.interval = seconds
                    self.next_telemetry = time.monotonic()
                else:
                    ok, info = False, "sec must be 1..60"
            elif command == "silent":
                self.buzzer = not bool(payload.get("on", True))
                info = "buzzer off" if not self.buzzer else "buzzer on"
            elif command == "calibrate":
                self.tilt = 3.0
                info = "upright reference updated"
            elif command == "status":
                self.publish_status()
            else:
                ok, info = False, "unknown command"
        self.publish("resp", {"id": self.code, "cmd": command, "ok": ok, "info": info, "up": self.uptime(),
                              "cid": cid}, qos=1)
        if command in ("interval", "silent") and ok:
            self.publish_status()

    # ── periodic behaviour ───────────────────────────────────
    def tick(self) -> None:
        now = time.monotonic()
        with self.lock:
            if self.prealert and now >= self.prealert[1]:
                kind, _, value = self.prealert
                self.prealert = None
                self.raise_alert(kind, CRITICAL, "event", value)
            if now < self.next_telemetry:
                return
            self.next_telemetry = now + self.interval
            self._evolve()
            self._rules(now)
            self.telemetry_seq += 1
            still_s = int(now - self.still_since) if self.still_since else self.rng.randint(0, 3)
            self.publish("telemetry", {
                "id": self.code, "seq": self.telemetry_seq, "up": self.uptime(), "ts": int(time.time()),
                "vest_t": round(self.temp, 1),
                "imu": {"peak_g": round(self.peak, 2), "tilt": int(round(self.tilt_now)),
                        "act": round(self.activity_now, 3), "posture": self.posture, "still_s": still_s},
                "rssi": int(-55 - 9 * abs(math.sin(time.time() / 90 + self.phase)) + self.rng.gauss(0, 1.5)),
                "alerts": self.mask(), "pre": self.prealert is not None,
            })

    def _evolve(self) -> None:
        moving = self.still_since is None and self.posture == "upright"
        self.temp += (self.target_temp - self.temp) * 0.18 + self.rng.gauss(0, 0.04)
        self.activity_now = max(0.0, self.activity + self.rng.gauss(0, 0.008)) if moving else abs(self.rng.gauss(0, 0.002))
        self.peak = 1.0 + (self.activity_now * 7 if moving else 0) + abs(self.rng.gauss(0, 0.02))
        self.tilt_now = max(0.0, min(180.0, self.tilt + self.rng.gauss(0, 1.2)))

    def _rules(self, now: float) -> None:
        severity = CRITICAL if self.temp >= 55 else WARNING if self.temp >= 45 else None
        self.update_condition("VEST_TEMP_HIGH", severity, self.temp)
        still_for = now - self.still_since if self.still_since else 0
        if still_for >= NO_MOTION_S:
            self.update_condition("NO_MOTION", CRITICAL if self.posture == "lying" else WARNING, still_for)
        else:
            self.update_condition("NO_MOTION", None, still_for)


DEMO_SCRIPT = [  # (seconds after start, command, device index)
    (150, "anomaly", 2),
    (210, "fall", 1),
    (270, "heat", 3),
    (330, "sos", 0),
    (390, "offline", 4),
    (500, "online", 4),
    (520, "cool", 3),
    (530, "walk", 1),
    (540, "walk", 2),
]

HELP = """commands: <scenario> <DEVICE>   e.g.  fall STA-03
  fall | mandown | ok (wearer cancels) | sos | impact | heat | fire | cool
  still | walk | anomaly | offline | online      — also: list, help, quit"""


def parse_args() -> argparse.Namespace:
    env = os.getenv
    parser = argparse.ArgumentParser(description="Smart Tactical Armor — virtual vests")
    parser.add_argument("--host", default=env("SIM_MQTT_HOST", "localhost"))
    parser.add_argument("--port", type=int, default=int(env("SIM_MQTT_PORT", "8883")))
    parser.add_argument("--username", default=env("SIM_MQTT_USERNAME", ""))
    parser.add_argument("--password", default=env("SIM_MQTT_PASSWORD", ""))
    parser.add_argument("--tls", action=argparse.BooleanOptionalAction, default=env("SIM_MQTT_TLS", "true") == "true")
    parser.add_argument("--topic-root", default=env("SIM_TOPIC_ROOT", "sta/v1"))
    parser.add_argument("--devices", default=env("SIM_DEVICES", "STA-02,STA-03,STA-04,STA-05,STA-06"))
    parser.add_argument("--interval", type=int, default=int(env("SIM_INTERVAL_S", "5")))
    parser.add_argument("--demo", action="store_true", help="run the scripted presentation scenario")
    parser.add_argument("--demo-speed", type=float, default=1.0, help="compress the demo timeline (2 = twice as fast)")
    parser.add_argument("--duration", type=int, default=0, help="stop after N seconds (0 = run until quit)")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--no-console", action="store_true", help="do not read commands from stdin")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rng = random.Random(args.seed)
    vests = [VirtualVest(code.strip().upper(), args, rng) for code in args.devices.split(",") if code.strip()]
    by_code = {vest.code: vest for vest in vests}
    print(f"Connecting {len(vests)} virtual vests to {args.host}:{args.port} (TLS {'on' if args.tls else 'off'})")
    for vest in vests:
        vest.start()

    stop = threading.Event()

    def console() -> None:
        print(HELP)
        for line in sys.stdin:
            parts = line.strip().split()
            if not parts:
                continue
            if parts[0] in ("quit", "exit"):
                stop.set()
                return
            if parts[0] == "help":
                print(HELP)
            elif parts[0] == "list":
                print(", ".join(f"{v.code}{' (offline)' if v.offline else ''}" for v in vests))
            elif len(parts) == 2 and parts[1].upper() in by_code:
                try:
                    by_code[parts[1].upper()].scenario(parts[0].lower())
                except ValueError:
                    print(f"unknown scenario {parts[0]!r}")
            else:
                print(HELP)

    if not args.no_console and sys.stdin and sys.stdin.isatty():
        threading.Thread(target=console, daemon=True).start()

    started = time.monotonic()
    speed = max(0.1, args.demo_speed)
    pending = sorted((at / speed, command, index) for at, command, index in DEMO_SCRIPT) if args.demo else []
    try:
        while not stop.is_set():
            elapsed = time.monotonic() - started
            while pending and elapsed >= pending[0][0]:
                _, command, index = pending.pop(0)
                if index < len(vests):
                    print(f"--- demo t+{int(elapsed)}s: {command} {vests[index].code}")
                    vests[index].scenario(command)
            for vest in vests:
                vest.tick()
            if args.duration and elapsed >= args.duration:
                break
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass
    for vest in vests:
        vest.stop()  # clean disconnect: the retained status stays "online" until the next run
    return 0


if __name__ == "__main__":
    sys.exit(main())
