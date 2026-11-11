# REST API reference

The Flask backend exposes one versioned JSON API. The React dashboard is its only client today. The
interactive **Swagger UI** at `/api/v1/docs` is generated from the same code (flask-restx), so it always
matches the running server. This page explains the conventions and shows real responses.

| Environment | Base URL |
|---|---|
| Local development | `http://localhost:5000/api/v1` |
| Render | `https://<api-service>.onrender.com/api/v1` |

The example payloads come from the running backend during the end-to-end test. Ids are shortened (`…`),
and a few values were edited so that each example shows a typical case.

## Contents
1. [Conventions](#1-conventions)
2. [Authentication and roles](#2-authentication-and-roles)
3. [Endpoint summary](#3-endpoint-summary)
4. [Auth](#4-auth)
5. [Overview](#5-overview)
6. [Devices (units)](#6-devices-units)
7. [Alerts (incidents)](#7-alerts-incidents)
8. [AI analysis](#8-ai-analysis)
9. [Armor and shielding](#9-armor-and-shielding)
10. [Personnel](#10-personnel)
11. [Operators](#11-operators)
12. [Health](#12-health)

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Format | JSON, UTF-8. Field names are `snake_case`. |
| Identifiers | UUID strings (`device_id`, `alert_id`, …). The vest's human code (`STA-01`) is `device_code`. |
| Time | ISO 8601 in UTC with offset, for example `2026-11-11T20:23:23.579030+00:00`. The dashboard shows Asia/Riyadh time. |
| Missing values | `null`. A sensor that is not fitted yet (Phase 2–4) reports `null`, never `0`. |
| Errors | `{"message": "<human-readable reason>"}` with the HTTP status below. |
| Paging | `limit` and `offset` query parameters. Paged lists return `{items, total, limit, offset}`. |
| Versioning | The prefix `/api/v1` is frozen. Breaking changes would get `/api/v2`. |

| Status | Meaning |
|---|---|
| `200` / `201` | OK / created |
| `400` | Invalid input, for example `interval 'sec' must be between 1 and 60` |
| `401` | Missing, invalid or expired token, or wrong email or password |
| `403` | Signed in, but the role does not allow the action |
| `404` | Unknown id |
| `409` | Conflict: duplicate email or device code, retired device |
| `429` | Too many failed sign-ins from one address |
| `503` | Health check: a dependency is down |

```json
// 401 without a token
{ "message": "Missing or malformed Authorization header" }
// 400 from POST /devices/{id}/commands with {"command_type": "interval", "params": {"sec": 99}}
{ "message": "interval 'sec' must be between 1 and 60" }
```

## 2. Authentication and roles

1. `POST /auth/login` with email and password returns an `access_token` (JWT, HS256, signed with
   `SECRET_KEY`). It is valid for `JWT_EXPIRES_MINUTES` (default 480 = 8 hours).
2. Send it on every other request: `Authorization: Bearer <access_token>`.
3. Each request checks the signature, the expiry **and** that the account is still active, so disabling an
   operator takes effect immediately.
4. After `LOGIN_MAX_ATTEMPTS` (5) failed attempts, the client address is locked out for
   `LOGIN_LOCKOUT_SECONDS` (300) and receives `429`.

| Role | Can do |
|---|---|
| `viewer` | Read everything: overview, map, units, incidents, analysis, armor. For supervisors and competition judges. |
| `operator` | Viewer **plus**: acknowledge and resolve incidents, send commands to vests. |
| `admin` | Operator **plus**: register and retire vests, manage personnel and operator accounts. |

The dashboard hides actions a role cannot perform. The API enforces the same rules independently.

## 3. Endpoint summary

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/auth/login` | public | Sign in, receive a token |
| GET | `/auth/me` | any | Current operator |
| POST | `/auth/change-password` | any | Change own password |
| GET | `/overview` | any | KPIs and every unit, for the command centre |
| GET | `/devices` | any | All vests with live state and AI risk |
| POST | `/devices` | admin | Register a vest |
| GET | `/devices/{device_id}` | any | One vest |
| PATCH | `/devices/{device_id}` | admin | Rename, assign a wearer, flags |
| DELETE | `/devices/{device_id}` | admin | Retire a vest (history is kept) |
| GET | `/devices/{device_id}/telemetry` | any | History for charts |
| GET | `/devices/{device_id}/commands` | any | Recent commands |
| POST | `/devices/{device_id}/commands` | operator | Send a command to the vest |
| GET | `/alerts` | any | Incidents, priority-ordered, filterable |
| GET | `/alerts/summary` | any | Open counts by severity |
| GET | `/alerts/{alert_id}` | any | One incident with its timeline |
| POST | `/alerts/{alert_id}/acknowledge` | operator | "Help is coming", and the vest is told |
| POST | `/alerts/{alert_id}/resolve` | operator | Close with a note |
| GET | `/analysis` | any | Risk ranking, baselines, model parameters |
| GET | `/armor/shielding` | any | Radiation-shielding lab dataset |
| POST | `/armor/shielding/estimate` | any | Transmission and dose behind the shield |
| GET | `/personnel` | any | Field members |
| POST | `/personnel` | admin | Add a field member |
| GET | `/personnel/{personnel_id}` | any | One field member |
| PATCH | `/personnel/{personnel_id}` | admin | Update a field member |
| DELETE | `/personnel/{personnel_id}` | admin | Deactivate and release their vest |
| GET | `/operators` | admin | Dashboard accounts |
| POST | `/operators` | admin | Create an account |
| PATCH | `/operators/{operator_id}` | admin | Rename, change role, disable, reset password |
| GET | `/health` | public | Liveness and dependencies |

## 4. Auth

### `POST /auth/login`

```json
// request
{ "email": "admin@sta.local", "password": "••••••••" }

// 200
{
  "access_token": "eyJhbGciOiJIUzI1…",
  "token_type": "Bearer",
  "expires_in": 28800,
  "operator": {
    "operator_id": "dd4ff09a-9b98-4ee6-994d-c4e70bc0f3b5",
    "full_name": "Duty Admin",
    "email": "admin@sta.local",
    "role": "admin",
    "is_active": true,
    "last_login_at": "2026-11-11T20:36:33.862800+00:00",
    "created_at": "2026-11-11T19:53:27.098739+00:00"
  }
}

// 401
{ "message": "Invalid email or password" }
```

`GET /auth/me` returns the same `operator` object. `POST /auth/change-password` takes
`{"current_password", "new_password"}`. The new password needs at least 8 characters.

## 5. Overview

### `GET /overview`

One call feeds the command-centre page. It returns KPIs and the full unit list, with each unit in the
same shape as `GET /devices/{id}`.

```json
{
  "generated_at": "2026-11-11T20:36:48.540245+00:00",
  "kpis": {
    "units_total": 6, "units_online": 6, "units_offline": 0, "units_simulated": 5,
    "personnel_assigned": 6,
    "alerts_open": 2, "alerts_critical": 2, "alerts_warning": 0, "alerts_pending": 0,
    "risk_average": 29, "risk_max": 100
  },
  "units": [ { "device_code": "STA-01", "risk": { "score": 100, "level": "critical" }, … } ]
}
```

## 6. Devices (units)

A *device* is one vest. Its row keeps a live cache (last telemetry, connection, risk), so list pages never
scan the history table.

### `GET /devices` and `GET /devices/{device_id}`

`?include_inactive=true` also lists retired vests.

```json
{
  "device_id": "a73bce6a-0466-4ca1-b43e-8e9d9687d510",
  "device_code": "STA-02",
  "display_name": "Vest STA-02",
  "is_simulated": true,
  "is_active": true,
  "personnel": {
    "personnel_id": "9eb39467-…", "callsign": "ALPHA-02", "full_name": "فرد ميداني 02",
    "unit_name": "Riyadh Response Team", "blood_type": null, "zone": "حي العليا",
    "post_lat": 24.6905, "post_lng": 46.6854, "rank": null
  },
  "firmware_version": "2.0.0",
  "ip_address": "10.0.0.12",
  "rssi": -56,
  "sensors": { "imu": "MPU-6050", "ppg": false, "temp": false, "gps": false, "geiger": false, "bat": false },
  "telemetry_interval_s": 5,
  "buzzer_enabled": true,
  "reported_online": true,
  "connection": "online",
  "last_seen_at": "2026-11-11T20:23:23.616938+00:00",
  "last_seen_age_s": 2,
  "boot_at": "2026-11-11T19:53:24.616938+00:00",
  "telemetry": {
    "seq": 1304, "uptime_s": 1799, "device_ts": "2026-11-11T20:23:23+00:00",
    "vest_temp_c": 31.0, "tilt_deg": 5.0, "posture": "upright",
    "activity_g": 0.033, "peak_g": 1.23, "still_s": 0, "rssi": -56,
    "alert_mask": 0, "prealert": false,
    "heart_rate": null, "spo2": null, "skin_temp_c": null, "sensor_contact": null,
    "lat": null, "lng": null, "gps_fix": null, "gps_sats": null,
    "radiation_usvh": null, "radiation_cpm": null, "radiation_dose_usv": null,
    "battery_pct": null, "battery_v": null,
    "anomaly_score": 0.2
  },
  "telemetry_at": "2026-11-11T20:23:23.616938+00:00",
  "device_alerts_active": [],
  "open_alerts": [
    { "alert_id": "33b9c420-…", "alert_type": "FALL", "severity": "critical",
      "status": "acknowledged", "source": "device", "priority": 54 }
  ],
  "risk": {
    "score": 100,
    "level": "critical",
    "factors": [
      { "code": "alert:FALL", "points": 72, "detail": "critical" },
      { "code": "alerts:additional", "points": 6, "detail": "1" }
    ],
    "updated_at": "2026-11-11T20:36:43.890584+00:00"
  },
  "position": { "lat": 24.6905, "lng": 46.6854, "source": "post" }
}
```

| Field | Notes |
|---|---|
| `connection` | `online`, `offline` (Last Will received, or silent for more than max(20 s, 3 × interval)) or `never` |
| `telemetry` | The latest message. Phase 2–4 fields stay `null` until those sensors are fitted |
| `vest_temp_c` | The MPU-6050 die temperature: vest or environment temperature, **not** body temperature |
| `anomaly_score` | Largest absolute z-score of this message against the wearer's own baseline |
| `risk.factors` | Why the score is what it is. The dashboard shows them as an explanation |
| `position.source` | `gps` once Phase 3 GPS is fitted. Until then `post`: the wearer's assigned post |

### `POST /devices` (admin)

```json
{ "device_code": "STA-01", "display_name": "Vest STA-01", "is_simulated": false,
  "personnel_id": "b38e8859-…", "notes": "Prototype on the lab bench" }
```

`device_code` must equal `DEVICE_ID` in the firmware **and** the vest's MQTT username. MQTT messages from
unregistered codes are rejected unless `DEVICE_AUTO_REGISTER=true`. A duplicate code returns `409`.

`PATCH /devices/{id}` accepts `display_name`, `is_simulated`, `personnel_id` (empty string to unassign),
`is_active` and `notes`. `DELETE` retires the vest: its history stays, and messages from it are ignored.

### `GET /devices/{device_id}/telemetry?minutes=30&limit=720`

`minutes` takes 1–1440, and `limit` takes 10–5000 (the newest points win). Points are stored at most every
`TELEMETRY_STORE_MIN_INTERVAL_S` (5 s), or immediately when the alert mask changes.

```json
{
  "device_id": "a73bce6a-…",
  "device_code": "STA-02",
  "minutes": 30,
  "points": [
    { "t": "2026-11-11T20:22:38.425121+00:00", "seq": 1259,
      "vest_temp_c": 31.0, "tilt_deg": 4.0, "posture": "upright", "activity_g": 0.037,
      "peak_g": 1.28, "still_s": 2, "rssi": -59, "alert_mask": 0, "prealert": false,
      "heart_rate": null, "spo2": null, "skin_temp_c": null, "lat": null, "lng": null,
      "radiation_usvh": null, "radiation_dose_usv": null, "battery_pct": null,
      "anomaly_score": 0.06 }
  ]
}
```

### `POST /devices/{device_id}/commands` (operator)

| `command_type` | `params` | Effect on the vest |
|---|---|---|
| `ping` | none | Replies `pong`: a round-trip check |
| `ack` | `{"type": "FALL"}` (optional) | "Help is coming": OK on the LED matrix, short buzz. Sent automatically when an incident is acknowledged |
| `evac` | none | Evacuation signal: urgent pattern |
| `stop` | none | Stop buzzer and vibration |
| `interval` | `{"sec": 1..60}` | Change the telemetry period, for example 2 s for a live demo |
| `silent` | `{"on": true}` | Mute (`true`) or unmute (`false`) the buzzer |
| `calibrate` | none | Take the current pose as "upright" |
| `status` | none | Re-publish the retained status message |

```json
// request
{ "command_type": "interval", "params": { "sec": 2 } }

// 201: the broker accepted the message; the vest's reply updates the same record
{
  "command_id": "c5ca4456-…", "device_id": "a73bce6a-…", "device_code": "STA-02",
  "command_type": "interval", "params": { "sec": 2 },
  "correlation_id": "447cb632",
  "status": "sent",
  "response_ok": null, "response_info": null,
  "issued_by": "Duty Admin", "alert_id": null,
  "issued_at": "2026-11-11T19:54:27.454802+00:00",
  "sent_at": "2026-11-11T19:54:27.469816+00:00",
  "completed_at": null
}
```

The answer is `201` even when the MQTT channel is down. In that case `status` is `failed` and
`response_info` says why, so the dashboard can show it. Life cycle: `queued → sent → acknowledged | failed`.
`timeout` follows after `COMMAND_TIMEOUT_S` (30 s) without a reply. See
[Behavioral UML 3.3](03-uml-behavioral.md#33-command-life-cycle).

`GET /devices/{id}/commands?limit=20` lists recent commands, newest first.

## 7. Alerts (incidents)

An **incident** groups every message about one alert type on one vest until it is closed. A pre-alert,
its escalation and the operator's actions all become events on one timeline. Redelivered messages (same
`seq` and uptime, after a QoS 1 retry or an offline replay) are dropped. Device and AI incidents share this
model; `source` tells them apart.

### `GET /alerts`

| Parameter | Values |
|---|---|
| `scope` | `open` (default: pending, open, acknowledged), `closed` (resolved, cleared, cancelled) or `all` |
| `severity` | `info`, `warning`, `critical` |
| `type` | Alert type, for example `FALL`, `SOS`, `TEMP_ANOMALY` |
| `source` | `device` (vest firmware) or `analysis` (server-side AI) |
| `device_id` | One vest |
| `since_hours` | Only incidents active in the last N hours |
| `limit`, `offset` | Paging. `limit` is at most 200, default 50 |

With `scope=open`, results are ordered by `priority` (most urgent first), then by the latest event.
Priority = base(type) × severity × status, plus up to 10 points with age. Other scopes list the most recent
first.

```json
{
  "items": [
    {
      "alert_id": "790121c4-9e6b-4191-95ca-197d945ac2c4",
      "alert_type": "CONTACT_LOST",
      "source": "analysis",
      "severity": "warning",
      "status": "open",
      "is_open": true,
      "priority": 59,
      "value": 800.0,
      "message": "No data from STA-01 for 800 s",
      "context": { "last_seen_at": "2026-11-11T20:23:23.579030+00:00" },
      "device_id": "fbabda9b-…", "device_code": "STA-01", "is_simulated": false,
      "personnel": { "personnel_id": "b38e8859-…", "callsign": "ALPHA-01",
                     "full_name": "فرد ميداني 01", "rank": null },
      "occurred_at": "2026-11-11T20:23:40.975866+00:00",
      "last_event_at": "2026-11-11T20:36:43.890584+00:00",
      "event_count": 1,
      "acknowledged_at": null, "acknowledged_by": null,
      "resolved_at": null, "resolved_by": null, "resolution_note": null
    }
  ],
  "total": 13, "limit": 50, "offset": 0
}
```

`GET /alerts/summary` returns `{"open_total": 8, "open_info": 0, "open_warning": 6, "open_critical": 2}`.

### `GET /alerts/{alert_id}`

This returns the same object plus `events`, the timeline:

```json
"events": [
  { "event_id": 15, "kind": "detected", "severity": "warning", "value": 17.0,
    "device_seq": null, "actor": null, "note": null,
    "received_at": "2026-11-11T20:23:40.975866+00:00" }
]
```

| Event kind | Recorded when |
|---|---|
| `pending` | The vest raised a pre-alert that the wearer can still cancel |
| `event` / `active` | The vest reported a one-off event, or a condition that is still present |
| `escalated` | The severity rose, for example a pre-alert nobody cancelled |
| `reopened` | An acknowledged incident became critical and needs a new acknowledgement |
| `detected` | The AI analysis raised the incident |
| `acknowledged` / `resolved` | An operator acted. `actor` and `note` are filled |
| `cleared` | The condition ended on its own |
| `cancelled` | The wearer pressed "I'm OK" |

### `POST /alerts/{alert_id}/acknowledge` and `/resolve` (operator)

Both take an optional note, `{"note": "Medic dispatched"}`, and return the updated incident.

* **Acknowledge** sets the status to `acknowledged` and sends the `ack` command to the vest, which tells the
  wearer that help is coming. If the incident later escalates to critical, it re-opens and needs a new
  acknowledgement.
* **Resolve** closes the incident with the note. Device conditions that end on their own close as
  `cleared` without operator action. A pre-alert the wearer cancels closes as `cancelled`.

### Alert types

| Type | Source | Phase | Meaning |
|---|---|---|---|
| `SOS` | vest | 1 | Button held for 2 s |
| `MAN_DOWN` | vest | 1 | Hard impact, then lying still |
| `FALL` | vest | 1 | Free fall, impact, then lying |
| `IMPACT` | vest | 1 | Acceleration ≥ 6 g |
| `NO_MOTION` | vest | 1 | No movement for 60 s (critical when lying) |
| `VEST_TEMP_HIGH` | vest | 1 | Vest temperature ≥ 45 °C (warning) or ≥ 55 °C (critical) |
| `HR_HIGH`, `HR_LOW`, `SPO2_LOW`, `SKIN_TEMP_HIGH`, `SKIN_TEMP_LOW`, `SENSOR_OFF`, `BATTERY_LOW` | vest | 2 | Vital signs and power |
| `GPS_LOST` | vest | 3 | No GPS fix |
| `RAD_RATE`, `RAD_DOSE` | vest | 4 | Dose rate or accumulated dose over the limit |
| `CONTACT_LOST` | AI | 1 | No data for `CONTACT_LOST_AFTER_S` (60 s) |
| `TEMP_ANOMALY`, `ACTIVITY_ANOMALY` | AI | 1 | Unusual for **this** wearer: 3σ from their own baseline for 3 readings |
| `HR_ANOMALY`, `SPO2_ANOMALY`, `SKIN_TEMP_ANOMALY` | AI | 2 | Same, for vital signs |
| `RADIATION_ANOMALY` | AI | 4 | Same, for the dose rate |

## 8. AI analysis

### `GET /analysis`

This returns the model parameters, so the method can be explained to an audience, and the per-unit
state:

```json
{
  "model": {
    "anomaly_detection": {
      "method": "per-wearer online baseline (Welford warm-up, then EWMA mean/variance) + z-score",
      "z_threshold": 3.0, "warmup_samples": 30, "ewma_alpha": 0.05, "persist_readings": 3,
      "metrics": [
        { "metric": "vest_temp_c", "direction": "up", "min_std": 0.4, "alert_type": "TEMP_ANOMALY" },
        { "metric": "activity_g", "direction": "up", "min_std": 0.03, "alert_type": "ACTIVITY_ANOMALY" }
      ]
    },
    "risk_model": {
      "levels": [ { "min_score": 75, "level": "critical" }, { "min_score": 50, "level": "high" }, … ],
      "factors": [ "open incidents (type x severity)", "pre-alert", … ]
    },
    "priority_model": "base(type) x severity x status + age boost (max +10 after 5 min)"
  },
  "units": [
    {
      "device_code": "STA-01", "connection": "online",
      "risk": { "score": 100, "level": "critical", "factors": [ … ] },
      "baselines": [
        { "metric": "vest_temp_c", "mean": 31.1784, "std": 0.0783, "samples": 1301,
          "consecutive_anomalies": 0, "last_value": 31.1, "last_z": -0.21,
          "last_anomaly_at": null, "updated_at": "2026-11-11T20:23:23.587665+00:00" }
      ]
    }
  ]
}
```

## 9. Armor and shielding

`GET /armor/shielding` returns the team's laboratory dataset for PMMA nanocomposites (Bi₂O₃, PbO, MgO) under
X-ray, Am-241 and Cs-137 beams: the linear attenuation coefficient μ, the half-value layer (HVL) and the
mean free path for each concentration. Values the report gives only as a chart are flagged
`"approximate": true`.

`POST /armor/shielding/estimate` applies the Beer–Lambert law, I = I₀·e^(−μx):

```json
// request
{ "material": "bi2o3", "beam": "cs137", "concentration_wt_pct": 8.333,
  "thickness_cm": 1.0, "incident_dose_usvh": 10 }

// 200
{
  "material": "bi2o3", "beam": "cs137", "concentration_wt_pct": 8.333, "thickness_cm": 1.0,
  "mu_cm": 1.0, "transmission": 0.367879, "attenuation_pct": 63.21,
  "hvl_cm": 0.693, "tvl_cm": 2.303, "mfp_cm": 1.0,
  "incident_dose_usvh": 10.0, "transmitted_dose_usvh": 3.6788,
  "approximate": false
}
```

## 10. Personnel

Field members, the people who wear the vests.

```json
{
  "personnel_id": "b38e8859-1cda-4c59-b278-e4f7213090f2",
  "callsign": "ALPHA-01",
  "full_name": "فرد ميداني 01",
  "rank": null,
  "unit_name": "Riyadh Response Team",
  "blood_type": null,
  "zone": "وسط الرياض",
  "post_lat": 24.7136, "post_lng": 46.6753,
  "notes": null,
  "is_active": true,
  "device_id": "fbabda9b-…", "device_code": "STA-01",
  "created_at": "2026-11-11T19:53:08.405789+00:00",
  "updated_at": "2026-11-11T19:53:08.405789+00:00"
}
```

`POST` requires `callsign` (unique) and `full_name`. `blood_type` accepts A+, A−, B+, B−, AB+, AB−, O+ and
O− in any letter case. `DELETE` deactivates the member and releases the vest. Their history is kept.

## 11. Operators

These endpoints are for administrators only.

* `GET /operators` lists accounts.
* `POST /operators` with `{email, full_name, role, password}` creates an account. A duplicate email
  returns `409`.
* `PATCH /operators/{id}` with any of `full_name`, `role`, `is_active` or `password` updates it.

The last active administrator cannot be demoted or disabled (`409`), so the system always keeps one.

## 12. Health

### `GET /health` (public)

Render's health check and uptime monitors call this endpoint. It returns `503` when the database is
unreachable.

```json
{
  "status": "ok",
  "database": "ok",
  "mqtt": { "enabled": true, "connected": true },
  "version": "1.0.0",
  "time": "2026-11-11T20:36:33.423392+00:00"
}
```
