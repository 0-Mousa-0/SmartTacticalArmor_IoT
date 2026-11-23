# Technical overview: end to end

This document describes the whole technical system of **Dera (Smart Tactical Armor)**, from the sensors on
the vest to the operator's screen. It covers the end-to-end block diagram, the protocol used on every link,
and the languages, frameworks, libraries, hardware and cloud services the system is built with.

It shows the **complete system built around the team's equipment kit**, including the parts not built yet:

| # | Equipment | Status |
|---|---|---|
| 1 | Arduino UNO R4 WiFi: the microcontroller | **Built**: firmware running |
| 2 | MPU-6050: motion (accelerometer + gyroscope) | **Built**: falls, impacts, posture, stillness |
| 3 | MPU-6050: temperature (its on-chip sensor) | **Built**: vest / environment temperature |
| 4 | Physiological sensor: heart rate + SpO₂ | **Planned**: protocol, database, AI and dashboard are ready; the firmware driver is next |
| 5 | Camera | **Planned**: designed in this document (snapshots on alerts) |

For more depth: [structural UML](02-uml-structural.md) · [behavioral UML](03-uml-behavioral.md) ·
[REST API](04-api-reference.md) · [MQTT protocol](05-mqtt-protocol.md).

## Contents
1. [The system at a glance](#1-the-system-at-a-glance)
2. [End-to-end block diagram](#2-end-to-end-block-diagram)
3. [How data moves through the system](#3-how-data-moves-through-the-system)
4. [Protocols](#4-protocols)
5. [Programming languages](#5-programming-languages)
6. [Frameworks and libraries](#6-frameworks-and-libraries)
7. [Hardware](#7-hardware)
8. [Cloud services and hosting](#8-cloud-services-and-hosting)
9. [Data formats and conventions](#9-data-formats-and-conventions)
10. [Security along the chain](#10-security-along-the-chain)
11. [Timing and capacity](#11-timing-and-capacity)
12. [From source code to running system](#12-from-source-code-to-running-system)

---

## 1. The system at a glance

The system has five blocks connected in a chain:

| # | Block | Runs on | Built with | Job |
|---|---|---|---|---|
| ① | **Smart vest** | Arduino UNO R4 WiFi with the MPU-6050 and the physiological sensor, plus a camera node | C++ (Arduino) | Protects the wearer (Kevlar + Bi₂O₃ layers), senses motion, temperature and vital signs, detects falls, impacts and inactivity, takes snapshots on alerts, reports over MQTT |
| ② | **Message broker** | EMQX Cloud Serverless | (managed service) | Relays messages between vests and the backend, enforces credentials and topic permissions |
| ③ | **Backend** | Render web service | Python 3.12, Flask | Ingests and validates messages, runs the AI analysis, stores data, serves the REST API, sends commands, receives camera snapshots |
| ④ | **Database and storage** | Supabase | PostgreSQL + Storage | Stores operators, personnel, vests, telemetry, incidents, commands and AI baselines; camera snapshots in a private bucket |
| ⑤ | **Dashboard** | Render static site (CDN) + the operator's browser | TypeScript, React | The operations room: live units, map, prioritized incidents, AI analysis, snapshots, commands |

The **vest simulator** (Python) can stand in for extra vests. It speaks exactly the same protocol as the
real firmware.

## 2. End-to-end block diagram

```mermaid
flowchart TB
    subgraph VEST["① Smart vest"]
        subgraph LAYERS["Protective layers · passive"]
            L1["01 Inner radiation layer<br/>PMMA / Bi₂O₃ nanocomposite<br/>X-ray and gamma attenuation"]
            L2["02 Outer ballistic layer<br/>Kevlar aramid fabric<br/>projectile and fragment protection"]
        end
        subgraph SENS["Sensors"]
            IMU["MPU-6050 · motion<br/>accel ±16 g · gyro ±2000 °/s<br/>falls · impacts · posture · stillness<br/>built"]
            TMP["MPU-6050 · temperature<br/>on-chip sensor<br/>vest / environment temperature<br/>built"]
            PPG["Physiological sensor<br/>heart rate + SpO₂ · skin contact<br/>MAX30102 type<br/>planned"]
        end
        BUS{{"I²C bus · 400 kHz<br/>0x68 · 0x57"}}
        subgraph CTRL["Arduino UNO R4 WiFi"]
            MCU["Microcontroller · Renesas RA4M1<br/>Arm Cortex-M4 · 48 MHz<br/>firmware in C++ (Arduino)<br/>built"]
            WIFI["ESP32-S3 Wi-Fi module<br/>TCP/IP · TLS · SNTP<br/>built"]
            LED["12×8 LED matrix<br/>status for the wearer<br/>built"]
            MCU -- "internal UART" --- WIFI
            MCU -- "on-board" --> LED
        end
        subgraph CAMN["Camera node"]
            CAM["Camera sensor · OV2640<br/>2 MP · JPEG snapshots<br/>planned"]
            CMCU["ESP32 (ESP32-CAM board)<br/>own Wi-Fi · TLS<br/>firmware in C++ (Arduino)<br/>planned"]
            CAM -- "DVP 8-bit parallel<br/>+ SCCB control" --> CMCU
        end
        BTN["SOS / I'm OK button<br/>optional · supported by the firmware"]
        PWR["USB-C power bank · 5 V"]
        TMP -. "same chip" .- IMU
        IMU --- BUS
        PPG --- BUS
        BUS -- "SDA / SCL" --> MCU
        BTN -- "GPIO D4" --> MCU
        MCU -- "trigger on alert<br/>GPIO D7 → 3.3 V divider" --> CMCU
        PWR == "5 V" ==> MCU
        PWR == "5 V" ==> CMCU
    end

    SIM["Vest simulator<br/>Python · paho-mqtt<br/>virtual vests STA-02…06"]

    subgraph BRK["② Broker · EMQX"]
        BROKER[("EMQX Cloud Serverless<br/>MQTT 3.1.1 broker<br/>username/password · topic ACL")]
    end

    subgraph API["③ Backend · Render"]
        GW["MQTT gateway · Python 3.12<br/>paho-mqtt · persistent session"]
        ING["Ingestion<br/>payload validation"]
        FAC["Facade<br/>use cases · transactions"]
        AI["AI analysis<br/>per-wearer baselines · z-score anomalies<br/>risk score · incident priority"]
        SHD["Shielding model<br/>Beer–Lambert · lab data"]
        HK["Housekeeper<br/>timeouts · contact lost · retention"]
        REST["REST API /api/v1<br/>Flask + flask-restx · JWT roles"]
        MED["Snapshot upload endpoint<br/>JPEG · device token<br/>planned"]
        ORM["Repositories<br/>SQLAlchemy ORM · Alembic"]
        GW --> ING --> FAC
        FAC --> AI
        FAC --> SHD
        HK --> FAC
        REST --> FAC
        MED --> FAC
        FAC --> ORM
        FAC -- "commands" --> GW
    end

    subgraph DB["④ Supabase"]
        POOL["Supavisor session pooler<br/>port 5432 · IPv4"]
        PG[("PostgreSQL<br/>tables · row-level security")]
        STO[("Storage · private bucket<br/>incident snapshots<br/>planned")]
        POOL --> PG
    end

    subgraph WEB["⑤ Dashboard"]
        CDN["Render static site / CDN<br/>HTML · JS · CSS bundle"]
        SPA["React 18 + TypeScript SPA<br/>in the operator's browser<br/>Arabic RTL · English"]
        CDN -- "HTTPS download" --> SPA
    end

    OSM["OpenStreetMap<br/>tile servers"]
    OP(["Operator"])

    WIFI -- "Wi-Fi 2.4 GHz → TCP → TLS → MQTT :8883<br/>telemetry · alert · status · resp" --> BROKER
    BROKER -- "cmd · QoS 1" --> WIFI
    CMCU -- "Wi-Fi 2.4 GHz → TLS → HTTPS POST<br/>image/jpeg" --> MED
    SIM -- "MQTT over TLS :8883" --> BROKER
    BROKER -- "MQTT over TLS :8883<br/>sta/v1/+/…" --> GW
    GW -- "sta/v1/&lt;id&gt;/cmd" --> BROKER
    ORM -- "PostgreSQL protocol over TLS<br/>psycopg2" --> POOL
    FAC -- "HTTPS · Storage API" --> STO
    SPA -- "HTTPS · REST/JSON · Bearer JWT<br/>polling every 3–15 s" --> REST
    SPA -- "HTTPS · signed image URL" --> STO
    SPA -- "HTTPS map tiles" --> OSM
    OP --> SPA
    L1 -. "lab measurements<br/>μ · HVL per beam" .-> SHD

    classDef built stroke:#2ea043,stroke-width:3px
    classDef planned stroke:#d29922,stroke-width:2px,stroke-dasharray:6 4
    classDef passive stroke:#8b949e,stroke-width:2px,stroke-dasharray:2 3
    class IMU,TMP,MCU,WIFI,LED built
    class PPG,CAM,CMCU,MED,STO planned
    class L1,L2 passive
```

| Border | Meaning |
|---|---|
| Solid green | Built and tested |
| Dashed amber | Planned: in the team's kit, not built yet |
| Dotted grey | Passive protection layers (no electronics) |

**Reading the diagram:** sensor data flows down, from the vest through the broker into the backend and
then the database. Camera snapshots take a separate path: straight from the camera node to the backend
over HTTPS, then into Supabase Storage. The dashboard pulls everything over HTTPS. Commands flow back up:
dashboard → REST API → backend → broker → vest. The protective layers have no electronics. Their
laboratory measurements feed the backend's shielding model, which the dashboard shows on its armor page.

## 3. How data moves through the system

### 3.1 A telemetry reading (every 5 s)

1. The firmware reads the MPU-6050 over **I²C** 100 times a second. One 14-byte burst returns the
   acceleration, the **temperature** and the rotation. From them it computes tilt, posture, activity, peak
   acceleration and stillness.
2. Every 5 s it builds a compact **JSON** message (about 170 bytes) with ArduinoJson.
3. The ESP32-S3 module sends it over **Wi-Fi**, **TCP** and **TLS** as an **MQTT PUBLISH** to
   `sta/v1/STA-01/telemetry` (QoS 0).
4. EMQX checks the vest's credentials and topic permission, then forwards the message to the backend's
   subscription `sta/v1/+/telemetry`.
5. The backend's MQTT gateway (paho-mqtt) hands it to the dispatcher. The ingestion layer validates every
   field, checks its range and drops anything implausible.
6. In **one database transaction**, the facade:
   * updates the vest's live state ("last seen", latest values);
   * runs the **AI**: it compares each value with the wearer's own learned baseline (z-score) and raises
     or clears an analysis incident;
   * stores a history row (at most one every 5 s);
   * recomputes the vest's **risk score** (0–100) and the reasons for it.
7. SQLAlchemy sends the SQL through **psycopg2** over the **PostgreSQL wire protocol with TLS** to
   Supabase's session pooler.
8. The open dashboard polls `GET /api/v1/devices/{id}` (every 3 s on the unit page) over **HTTPS**, with
   a **JWT** in the `Authorization` header, and React re-renders the sensor tiles, risk and charts.

### 3.2 An alert (fall)

1. The firmware's fall detector sees free fall, then an impact, then the wearer lying for 2.5 s.
2. The vest publishes `FALL` with state `pending` on `sta/v1/STA-01/alert` (**QoS 1**) and blinks "!" on the
   LED matrix: the wearer has 10 s to press "I'm OK".
3. With no answer, it publishes `FALL` with state `event` and severity critical. If the vest is offline,
   the alert waits in its outbox (up to 16 messages) and is sent when the connection returns.
4. The backend opens or escalates the incident, ranks it by priority and raises the risk score. The
   dashboard shows it at the top of the queue within one polling cycle.
5. *(Planned)* The UNO pulses the camera trigger line, and the snapshot is attached to the incident
   (see 3.6).

### 3.3 A command (operator → vest)

1. The operator clicks **Acknowledge** (or a command button). The browser sends `POST` over HTTPS.
2. The API checks the role, stores the command with a **correlation id** (`cid`) and publishes it to
   `sta/v1/STA-01/cmd` (**QoS 1**).
3. The vest executes it (for `ack`: "OK" on the LED matrix) and replies on `sta/v1/STA-01/resp` with the
   same `cid`.
4. The backend matches the reply and marks the command `acknowledged`. Without a reply within 30 s, it
   marks it `timeout`.

### 3.4 Losing a vest

When it connects, the vest registers a **Last Will** message with the broker. If power or Wi-Fi is lost,
the broker publishes `{"online": false}` on the vest's retained `status` topic. The backend marks the vest
offline at once and raises `CONTACT_LOST` after 60 s of silence. Both clear automatically when it returns.

### 3.5 What each piece of equipment contributes

| Equipment | The firmware computes | Telemetry fields | Vest alerts (warning / critical) | AI on the server | Dashboard |
|---|---|---|---|---|---|
| MPU-6050 motion *(built)* | Tilt, posture, activity, peak g, stillness, falls | `imu.*` | `FALL`, `MAN_DOWN`, `IMPACT`, `NO_MOTION` | `ACTIVITY_ANOMALY` | Posture and motion tiles, trends |
| MPU-6050 temperature *(built)* | Chip temperature, which reads a few °C above the surrounding air | `vest_t` | `VEST_TEMP_HIGH` (45 / 55 °C) | `TEMP_ANOMALY` | Vest-temperature tile and trend, labelled "environment, not body" |
| Physiological sensor *(planned)* | Heart rate and blood oxygen from red/IR light; skin contact from the IR level | `vit.hr`, `vit.spo2`, `vit.contact` | `HR_HIGH` (160 / 190 bpm), `HR_LOW` (45 / 35 bpm), `SPO2_LOW` (92 / 88 %), `SENSOR_OFF` | `HR_ANOMALY`, `SPO2_ANOMALY` | Heart-rate and SpO₂ tiles, trends |
| Camera *(planned)* | A JPEG snapshot when triggered | none: images do not travel over MQTT | Taken automatically on `SOS`, `FALL`, `MAN_DOWN` and `IMPACT`, or on an operator's request | | Snapshot on the incident and on the unit page |

The heart-rate and SpO₂ thresholds come from the prototype design (`legacy/v1-mqtt-firmware/SmartTacticalArmor/config.h`)
and will be tuned with field data. Until the physiological sensor is fitted, its fields are absent, the
vest reports it as not fitted in its `status` message, and the dashboard shows "Not fitted" instead of a
value.

### 3.6 Camera snapshots (planned design)

1. **Trigger.** When the UNO raises `SOS`, `FALL`, `MAN_DOWN` or `IMPACT`, it pulses GPIO D7. An operator
   can also ask for a snapshot: the request reaches the UNO as an MQTT command, and it pulses the same
   line.
2. **Capture.** The ESP32-CAM wakes on the pulse, takes a JPEG from the OV2640 (640 × 480, about
   20–60 KB) and adds the vest id, the time and the reason.
3. **Upload.** It sends the image straight to the backend over **Wi-Fi → TLS → HTTPS POST**
   (`image/jpeg`), authenticated with a per-device upload token.
4. **Store.** The backend saves the file in a private **Supabase Storage** bucket. It records the
   metadata (vest, time, reason, linked incident) in PostgreSQL.
5. **Show.** The dashboard displays the snapshot on the incident and on the unit page. It loads the image
   through a short-lived signed URL, so only signed-in operators can see it.

**Why images do not pass through the UNO or MQTT:** the UNO R4 has 32 KB of RAM, which is too small to
buffer camera frames. The EMQX free plan allows 1 GB a month, and every message passes through it twice
(in and out). A separate Wi-Fi camera node keeps both paths light, and HTTPS uploads go directly to the
backend. If your camera is an SPI module instead (for example an ArduCAM Mini with an OV2640), it
connects to the UNO over SPI + I²C and the UNO uploads the image in small chunks. That works, but it is
slower and pauses motion sensing during the upload.

## 4. Protocols

### 4.1 Protocol on every link

| Link | Physical / network | Transport and security | Application protocol | Payload |
|---|---|---|---|---|
| MPU-6050 → RA4M1 *(built)* | I²C bus, 400 kHz, address `0x68` | none (wired in the vest) | MPU-6050 register map | 14-byte burst: acceleration, **temperature**, rotation |
| Physiological sensor → RA4M1 *(planned)* | Same I²C bus, address `0x57` | none | MAX30102 register map, sample FIFO | Red and IR light samples |
| Button → RA4M1 *(optional)* | GPIO D4, internal pull-up | none | Debounced short press / 2 s hold | |
| RA4M1 ↔ ESP32-S3 *(built)* | Internal UART on the board | none (on-board) | The WiFiS3 library's command protocol | |
| RA4M1 → camera node *(planned)* | GPIO D7 → ESP32-CAM GPIO 13, through a 5 V → 3.3 V divider, common ground | none | Trigger pulse | |
| OV2640 → ESP32 *(planned)* | DVP 8-bit parallel pixel bus + SCCB (I²C-like) for configuration | none (on the camera board) | OV2640 JPEG output | JPEG frames |
| Vest → EMQX *(built)* | Wi-Fi 802.11 b/g/n, 2.4 GHz, IPv4 | TCP, **TLS** (done by the ESP32-S3) | **MQTT 3.1.1**, port 8883 | JSON |
| Camera node → backend *(planned)* | Wi-Fi 802.11 b/g/n, 2.4 GHz, IPv4 | TCP, **TLS** | **HTTPS POST**, per-device token | JPEG |
| Simulator → EMQX | Internet, IPv4 | TCP, TLS (certifi CA bundle) | MQTT 3.1.1, port 8883 | JSON |
| EMQX ↔ backend | Internet, IPv4 | TCP, TLS (certifi CA bundle) | MQTT 3.1.1, port 8883, persistent session | JSON |
| Vest clock | Wi-Fi | UDP | **SNTP**, through the Wi-Fi module (`WiFi.getTime()`) | Unix time |
| Backend → Supabase PostgreSQL | Internet, IPv4 | TCP, TLS (`sslmode=require`) | **PostgreSQL wire protocol** via the Supavisor session pooler, port 5432 | SQL |
| Backend → Supabase Storage *(planned)* | Internet | TLS (HTTPS) | Supabase Storage REST API | JPEG |
| Browser → dashboard host | Internet | TLS (HTTPS) | HTTP | HTML, JS, CSS |
| Browser → API | Internet | TLS (HTTPS, terminated by Render's proxy) | HTTP/1.1 **REST**, JSON, `Authorization: Bearer <JWT>` | JSON |
| Browser → Supabase Storage *(planned)* | Internet | TLS (HTTPS) | HTTP GET with a signed, short-lived URL | JPEG |
| Browser → map tiles | Internet | TLS (HTTPS) | HTTP | PNG tiles |
| GitHub → Render | Internet | HTTPS webhooks | Git + Render deploy hooks | |

### 4.2 MQTT in this system

| Feature | How it is used |
|---|---|
| Topics | `sta/v1/<DEVICE_ID>/<telemetry | alert | status | resp | cmd>` |
| QoS 0 | Telemetry: frequent, and only the newest value matters |
| QoS 1 | Alerts, status, command replies and commands: at-least-once delivery. The backend drops duplicates by message sequence and uptime |
| Retained message | `status`: anyone who subscribes learns each vest's last state at once |
| Last Will and Testament | `{"online": false}` on `status`: the broker reports a vest that vanishes |
| Persistent session | Backend client id `sta-backend`, `clean_session=false`: the broker queues QoS 1 messages while the backend restarts or sleeps |
| Keep-alive | 30 s (vest and backend) |
| Authentication and authorization | One username/password per client. An ACL limits each vest to its own topics |
| Not used for | Images. Camera snapshots go over HTTPS (§ 3.6) |

Full message formats: [MQTT protocol](05-mqtt-protocol.md).

### 4.3 HTTP API

| Item | Value |
|---|---|
| Style | REST, resource URLs under `/api/v1`, JSON bodies, standard status codes |
| Authentication | `POST /auth/login` returns a **JWT** (HS256, 8 h). It is sent as `Authorization: Bearer …` |
| Authorization | Roles `viewer`, `operator` and `admin`, checked on every endpoint. Optional public access (`PUBLIC_ACCESS_ROLE`) gives visitors without a token one fixed role |
| Documentation | Swagger UI at `/api/v1/docs`, generated from the code by flask-restx |
| Cross-origin | CORS allows only the dashboard's origin (`CORS_ORIGINS`) |
| Live updates | The dashboard polls with TanStack Query every 3–15 s, depending on the page |
| Camera uploads *(planned)* | A separate upload endpoint that accepts `image/jpeg` with a per-device token, not an operator login |

Endpoint list: [REST API reference](04-api-reference.md).

## 5. Programming languages

| Language | Version | Where it is used |
|---|---|---|
| **C++** | C++17 (GCC for Arm via the Arduino Renesas core; g++, clang++ or zig for host tests) | Vest firmware (`firmware/`), its unit tests, and the planned camera-node firmware (Arduino core for ESP32) |
| **Python** | 3.12 | Backend (`backend/`), simulator, end-to-end checker (`tools/`) |
| **TypeScript** (TSX) | 5.7 | Dashboard (`frontend/src/`) |
| **SQL** (PostgreSQL) | | Schema created by Alembic migrations; row-level security statements |
| **CSS** | CSS Modules + custom properties (design tokens) | Dashboard styling, dark map filter, RTL-aware layout |
| **HTML** | HTML5 | Dashboard shell (`index.html`) |
| **JavaScript** (Node.js 24) | ES2022 | Build tooling configuration, the local test broker (`tools/e2e/local_broker.js`) |
| **YAML** | | CI workflow (`.github/workflows/ci.yml`), Render Blueprint (`render.yaml`) |
| **JSON** | | Every MQTT and REST payload; package manifests |
| **Shell / PowerShell** | | Firmware test runners |
| **Markdown + Mermaid** | | Documentation and every diagram |

## 6. Frameworks and libraries

### 6.1 Vest firmware

| Library | Version | Purpose |
|---|---|---|
| Arduino core for UNO R4 (`arduino:renesas_uno`) | 1.6.0 | Board support, compiler, `Wire` (I²C) |
| WiFiS3 | bundled with the core | Wi-Fi, `WiFiSSLClient` (TLS), `WiFi.getTime()` (SNTP) |
| Arduino_LED_Matrix | bundled with the core | 12×8 LED matrix frames |
| ArduinoMqttClient | latest from the Library Manager | MQTT 3.1.1 client with Last Will |
| ArduinoJson | 7.x | JSON payload encoding and command parsing |
| Own modules | `firmware/SmartTacticalArmor/src/` | MPU-6050 driver (motion + temperature), MotionAnalyzer, FallDetector, AlertManager, AlertOutbox, SosButton, MqttLink, StatusDisplay |
| SparkFun MAX3010x Pulse and Proximity Sensor Library | planned | Physiological sensor driver and the heart-rate / SpO₂ algorithm |

### 6.2 Camera node *(planned)*

| Library | Purpose |
|---|---|
| Arduino core for ESP32 (`esp32:esp32`) | Board support for the ESP32-CAM |
| esp32-camera driver (`esp_camera.h`) | OV2640 configuration and JPEG capture |
| WiFi + WiFiClientSecure + HTTPClient | Wi-Fi, TLS and the HTTPS upload |

### 6.3 Backend

| Library | Version | Purpose |
|---|---|---|
| Flask | 3.1.3 | Web framework |
| flask-restx | 1.3.2 | REST namespaces, request validation, Swagger UI |
| Flask-SQLAlchemy / SQLAlchemy | 3.1.1 / 2.1.8 | ORM |
| Flask-Migrate / Alembic | 4.1.0 / 1.20.1 | Database migrations |
| psycopg2-binary | 2.9.13 | PostgreSQL driver |
| paho-mqtt | 2.2.0 | MQTT client (gateway) |
| PyJWT | 2.15.1 | Session tokens (HS256) |
| flask-cors | 6.0.5 | Cross-origin rules |
| certifi | 2026.10.23 | Trusted root certificates for TLS |
| python-dotenv | 1.2.4 | `.env` loading in development |
| gunicorn | 27.0.0 | Production server: 1 worker, 8 threads |
| pytest / ruff | 9.2.0 / 0.17.4 | Tests / lint |
| Supabase Storage API | planned | Saving and signing camera snapshots |

The AI analysis (Welford and EWMA baselines, z-scores, risk fusion, priority, Beer–Lambert shielding) is
written in plain Python with no ML framework. It is fully explainable and light enough for the free tier.

### 6.4 Dashboard

| Library | Version | Purpose |
|---|---|---|
| React / React DOM | 18.3.1 | UI library |
| React Router | 6.30.6 | Pages and navigation, lazy-loaded routes |
| TanStack Query | 5.107.1 | Server state, polling, caching |
| Leaflet / React Leaflet | 1.9.4 / 4.2.1 | Operational map (OpenStreetMap tiles) |
| Recharts | 2.15.4 | Trend charts |
| Vite / @vitejs/plugin-react | 6.4.6 / 4.7.0 | Development server and production build |
| TypeScript | 5.7.3 | Static typing, including type-checked translation keys |
| Vitest / Testing Library / jsdom | 3.2.7 / 16.3.3 / 25.0.1 | Unit and component tests |
| ESLint / typescript-eslint | 9.39.5 / 8.72.2 | Lint, including the clean-architecture layer rules |
| IBM Plex Sans Arabic, IBM Plex Mono | Google Fonts | Typography for Arabic and numbers |

The dashboard's own code is organised by feature, with each feature split into domain, data, application
and presentation layers, plus a dependency-injection container. Translations are built in (Arabic and
English) without an i18n framework.

### 6.5 Tools

| Tool | Version | Purpose |
|---|---|---|
| Vest simulator | Python + paho-mqtt 2.2.0 | Virtual vests that speak the real protocol |
| aedes | 0.51.3 (Node.js) | Throwaway local MQTT broker for the end-to-end test |
| GitHub Actions | checkout v5, setup-python v6, setup-node v5, arduino/compile-sketches v1 | Continuous integration |
| arduino-cli / Arduino IDE | | Compiling and uploading the firmware |
| MQTTX | | Watching MQTT traffic by hand |

## 7. Hardware

### 7.1 The equipment kit

| Equipment | Part | Measures / does | Interface | Status |
|---|---|---|---|---|
| **Microcontroller** | **Arduino UNO R4 WiFi**: Renesas RA4M1 (Arm Cortex-M4F, 48 MHz, 256 KB flash, 32 KB RAM), an ESP32-S3 Wi-Fi module and a 12×8 LED matrix | Collects sensor data, runs the alert logic, sends it over Wi-Fi with TLS, shows status to the wearer. The firmware uses 40 % of flash and 36 % of RAM | | Built |
| **Motion sensor** | **MPU-6050** (GY-521 board) | 3-axis accelerometer (±16 g) and 3-axis gyroscope (±2000 °/s): falls, impacts, posture, activity, stillness | I²C `0x68` | Built |
| **Temperature** | The MPU-6050's on-chip temperature sensor | Vest / environment temperature. It reads a few °C above the air because the chip warms itself, so it is not body temperature | Same chip, same I²C read | Built |
| **Physiological sensor** | Heart rate + SpO₂ module (MAX30102 type) | Heart rate (bpm), blood oxygen (%), skin contact | I²C `0x57` | Planned |
| **Camera** | Camera node: **ESP32-CAM** board (ESP32 + OV2640, 2 MP) | JPEG snapshots on alerts or on request | Own Wi-Fi; trigger line from the UNO | Planned |
| SOS / I'm OK button | Any push button, or a jumper wire for tests | SOS (hold 2 s), "I'm OK" (short press) | GPIO D4 | Optional; supported by the firmware |
| Power | USB-C power bank, 5 V | Powers the UNO and the camera node | USB-C / 5 V pin | |

If your physiological sensor is a different model, only the address or pin in this table changes. For
example, a MAX30100 also sits at `0x57`, while an analog pulse sensor uses an analog pin. The same applies
if your camera is an SPI module (§ 3.6). The rest of the system stays the same.

### 7.2 Pin map

| Pin | Connected to | Notes |
|---|---|---|
| SDA / SCL (A4 / A5) or the Qwiic connector (`Wire1`) | MPU-6050 `0x68`, physiological sensor `0x57` | One shared I²C bus at 400 kHz, with no address conflict. MAX3010x boards are 3.3 V parts: use the 3.3 V Qwiic bus or a level-shifted board |
| D4 | SOS / I'm OK button to GND | Internal pull-up |
| D7 | Camera trigger → ESP32-CAM GPIO 13 | Through a divider (for example 1 kΩ / 2 kΩ): the UNO uses 5 V logic, while the ESP32 is 3.3 V and not 5 V-tolerant |
| GND | Camera node GND | A common ground is required for the trigger line |
| USB-C | Power bank or laptop | Power and programming |

### 7.3 Power

The power bank feeds the UNO through USB-C. The camera node gets its own 5 V lead from the same power
bank, because the ESP32-CAM draws current peaks of a few hundred mA while transmitting over Wi-Fi.
Battery-level monitoring is not part of the current kit.

### 7.4 Protective layers (passive)

| Layer (wearer → outside) | Material | Protects against | Data in the system |
|---|---|---|---|
| 01 Inner radiation layer | PMMA / Bi₂O₃ nanocomposite | X-ray and gamma radiation (attenuation) | The team's lab measurements (μ, HVL, mean free path for X-ray, Am-241 and Cs-137) feed the shielding model and the armor page |
| 02 Outer ballistic layer | Kevlar aramid fabric | Projectiles and fragments | Described on the armor page |

The order on the body is: wearer → Bi₂O₃ composite → Kevlar → outside. The controller and camera sit in
pouches on the carrier. The physiological sensor sits inside the vest, against the skin.

### 7.5 Future extensions (in the concept, not in the current kit)

The concept also shows a **GPS** (location tracking) and a **radiation sensor** (exposure monitoring). A
skin-contact temperature sensor and battery monitoring are natural next steps. None of them is in the kit
or in the diagram above. The MQTT protocol, the database, the AI analysis and the dashboard already have
fields for them (`gps.*`, `rad.*`, `vit.skin_t`, `bat.*`), so adding one later only needs its firmware
driver.

## 8. Cloud services and hosting

| Service | Plan | Region | Used for |
|---|---|---|---|
| **GitHub** | Free | | Source code, pull requests, GitHub Actions CI |
| **EMQX Cloud Serverless** | Free (1 GB traffic and 1 M session-minutes per month) | AWS eu-central-1 (Frankfurt) | MQTT broker |
| **Render** web service | Free (512 MB RAM, sleeps after 15 min idle) | Frankfurt | Backend API, MQTT ingestion, snapshot uploads (planned) |
| **Render** static site | Free (global CDN) | | Dashboard files |
| **Supabase** PostgreSQL | Free (500 MB database) | Central EU (Frankfurt) | All structured data |
| **Supabase** Storage | Free (1 GB files) | Central EU (Frankfurt) | Camera snapshots (planned) |
| **OpenStreetMap** | Free tile service | | Map background |

Everything is defined as code where possible: `render.yaml` creates both Render services, Alembic
migrations create the database schema, and `.github/workflows/ci.yml` defines the CI pipeline.

## 9. Data formats and conventions

| Topic | Convention |
|---|---|
| Messages | Compact JSON on MQTT. JSON with `snake_case` fields on the REST API |
| Images | JPEG, 640 × 480 by default, uploaded over HTTPS |
| Time | Vest: Unix epoch seconds (`ts`) and uptime (`up`). API and database: ISO 8601 in UTC. Dashboard: Asia/Riyadh time |
| Identifiers | UUIDs for database rows. `STA-01`-style codes for vests (also their MQTT username) |
| Units | °C, g (gravity), degrees, seconds, dBm, bpm, % SpO₂ |
| Missing data | `null`. A sensor that is not fitted never reports a fake value |
| Severity | Vest: `1`, `2` or `3`. API: `info`, `warning` or `critical` |
| Versions | REST `/api/v1`, MQTT `sta/v1`, firmware `2.0.0`, API `1.0.0` |

## 10. Security along the chain

| Hop | Protection |
|---|---|
| Vest ↔ broker | TLS encryption. A unique username and password per vest. An ACL ([EMQX setup § 4](07-setup-emqx.md#4-authorization-acl-recommended)) restricts each vest to its own topics. Credentials live only in the git-ignored `arduino_secrets.h` |
| Camera node → backend *(planned)* | HTTPS only, with a per-device upload token that can only add snapshots for its own vest |
| Broker ↔ backend | TLS with certificate verification (certifi). A dedicated `sta-backend` account |
| Backend input | Every MQTT message is validated: the `id` must match the topic, values must be within physical ranges, and unknown vests are rejected |
| Browser ↔ API | HTTPS only. JWT sessions that expire after 8 h. Role checks on every endpoint. Login lockout after 5 failures. CORS limited to the dashboard. With `PUBLIC_ACCESS_ROLE` set, anyone who has the dashboard link can use it with that role: a demo setting, not for real operations |
| Snapshots *(planned)* | A private storage bucket. The dashboard gets short-lived signed URLs, so only signed-in operators can view images of people |
| API ↔ database | TLS (`sslmode=require`). Credentials in environment variables. Row-level security closes Supabase's public Data API |
| Dashboard host | `X-Frame-Options: DENY`, strict referrer policy |
| Configuration | Secrets only in environment variables or git-ignored files. Production refuses to start with development defaults |

## 11. Timing and capacity

| Item | Value |
|---|---|
| IMU sampling (motion + temperature) | 100 Hz (every 10 ms) |
| Rule evaluation on the vest (no motion, heat) | Every 1 s |
| LED matrix refresh | Every 250 ms |
| Telemetry period | 5 s by default, 1–60 s by command |
| Fall pre-alert window | 10 s |
| SOS hold | 2 s |
| No-motion alert | After 60 s still |
| Reminder for an ongoing condition | Every 30 s |
| Vest offline (backend view) | Last Will at once, or silent for max(20 s, 3 × interval) |
| `CONTACT_LOST` incident | After 60 s without data |
| Command timeout | 30 s |
| Backend housekeeping | Every 15 s |
| Telemetry stored | At most every 5 s per vest. Kept for 7 days |
| Dashboard refresh | Every 3–15 s, depending on the page |
| Heart rate + SpO₂ *(planned)* | Computed over a sliding window of a few seconds of light samples |
| Camera snapshot *(planned)* | About 20–60 KB per JPEG. Taken only on alerts or on request, never as a continuous stream |
| Bandwidth, today | About 170 bytes per telemetry message, about 250 MB per vest per month at 5 s |
| Bandwidth with the physiological sensor | About 230 bytes per message, about 300 MB per vest per month at 5 s. Three vests fit the EMQX free tier at 5 s |
| Snapshot storage | 1 GB of free Supabase Storage holds roughly 20 000 snapshots. They do not use the EMQX quota |

## 12. From source code to running system

```mermaid
flowchart LR
    subgraph REPO["GitHub repository: main"]
        FWS["firmware/<br/>C++"]
        BES["backend/<br/>Python"]
        FES["frontend/<br/>TypeScript"]
    end

    REPO -- "every push" --> CI["GitHub Actions CI<br/>tests · lint · builds"]
    CI -- "all green" --> RD["Render auto-deploy"]

    FWS -- "Arduino IDE or arduino-cli<br/>GCC for Arm" --> BIN["Firmware binary"]
    BIN -- "USB-C upload" --> BOARD["UNO R4 WiFi<br/>in the vest"]

    BES -- "pip install" --> SRV["gunicorn + Flask<br/>migrations on start"]
    RD --> SRV

    FES -- "tsc + Vite build" --> DIST["Static bundle<br/>HTML · JS · CSS"]
    RD --> DIST
    DIST --> CDNS["Render CDN"]
```

| Component | Build | Delivery | Runs as |
|---|---|---|---|
| Vest firmware | Arduino toolchain (GCC for Arm) | USB upload from a laptop | Bare-metal loop on the RA4M1, no RTOS, cooperative scheduler |
| Camera-node firmware *(planned)* | Arduino core for ESP32 | Upload from a laptop through a USB-serial adapter | Sleeps until the trigger, captures, uploads |
| Backend | `pip install -r requirements.txt` | Render auto-deploy after CI passes | gunicorn, 1 worker with 8 threads. The same process holds the MQTT session and the housekeeping thread |
| Dashboard | `npm ci && npm run build` (tsc + Vite) | Render auto-deploy after CI passes | Static files on a CDN, run in the browser |
| Database schema | Alembic revisions | Applied automatically when the API starts | PostgreSQL on Supabase |
