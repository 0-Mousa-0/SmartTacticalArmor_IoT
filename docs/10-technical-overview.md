# Technical overview: end to end

This document describes the whole technical system of **Dera (Smart Tactical Armor)**, from the sensors on
the vest to the operator's screen. It covers the end-to-end block diagram, the protocol used on every link,
and the languages, frameworks, libraries, hardware and cloud services the system is built with.

It shows the **complete target system**: every piece of equipment the vest will carry, not only what is
built today. Phase 1 (UNO R4 WiFi, MPU-6050 IMU, SOS button, LED matrix) is built and tested end to end.
The heart-rate/SpO₂, skin-temperature, GPS, radiation and battery hardware (Phases 2–4) is planned. The
MQTT protocol, database, AI analysis and dashboard already accept the data from that hardware.

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
| ① | **Smart vest** | Arduino UNO R4 WiFi with the sensor suite: IMU (built); heart rate + SpO₂, skin temperature, GPS, Geiger counter, battery (planned) | C++ (Arduino) | Protects the wearer (Kevlar + Bi₂O₃ layers), senses motion, vital signs, position and radiation, detects falls, impacts and inactivity, handles the SOS button, alerts the wearer, reports over MQTT |
| ② | **Message broker** | EMQX Cloud Serverless | (managed service) | Relays messages between vests and the backend, enforces credentials and topic permissions |
| ③ | **Backend** | Render web service | Python 3.12, Flask | Ingests and validates messages, runs the AI analysis, stores data, serves the REST API, sends commands |
| ④ | **Database** | Supabase | PostgreSQL | Stores operators, personnel, vests, telemetry, incidents, commands and AI baselines |
| ⑤ | **Dashboard** | Render static site (CDN) + the operator's browser | TypeScript, React | The operations room: live units, map, prioritized incidents, AI analysis, commands |

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
            IMU["IMU · MPU-6050<br/>fall · impact · posture · vest temp<br/>Phase 1 · built"]
            PPG["Heart rate + SpO₂ · MAX30102<br/>skin-contact optical sensor<br/>Phase 2"]
            SKT["Skin temperature · MAX30205<br/>skin-contact · ±0.1 °C<br/>Phase 2"]
            GPS["GPS · u-blox NEO-6M / NEO-M8N<br/>position and movement<br/>Phase 3"]
            GEI["Radiation · RadiationD v1.1 Geiger<br/>J305 tube · gamma and X-ray<br/>Phase 4"]
            BTN["SOS / I'm OK button<br/>Phase 1 · built"]
        end
        BUS{{"I²C bus · 400 kHz<br/>0x68 · 0x57 · 0x48"}}
        subgraph CTRL["Controller · UNO R4 WiFi"]
            MCU["Renesas RA4M1<br/>Arm Cortex-M4 · 48 MHz<br/>firmware in C++ (Arduino)"]
            WIFI["ESP32-S3 Wi-Fi module<br/>TCP/IP · TLS · SNTP"]
            MCU -- "internal UART" --- WIFI
        end
        subgraph FEED["Wearer feedback"]
            LED["12×8 LED matrix<br/>Phase 1 · built"]
            VIB["Vibration motor<br/>Phase 2 · driver ready"]
            BUZ["Buzzer<br/>Phase 2 · driver ready"]
        end
        BAT["Battery · 2S Li-ion 7.4 V<br/>Phase 2"]
        IMU --- BUS
        PPG --- BUS
        SKT --- BUS
        BUS -- "SDA / SCL" --> MCU
        GPS -- "UART · NMEA 0183<br/>9600 baud · D0/D1" --> MCU
        GEI -- "pulse per particle<br/>interrupt D2" --> MCU
        BTN -- "GPIO D4" --> MCU
        BAT == "power → VIN" ==> MCU
        BAT -. "voltage divider → ADC A0" .-> MCU
        MCU -- "GPIO" --> LED
        MCU -- "PWM D5 · MOSFET" --> VIB
        MCU -- "GPIO D6 · transistor" --> BUZ
    end

    SAT(["GNSS satellites<br/>GPS L1 signal"])
    SAT -. "radio" .-> GPS

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
        ORM["Repositories<br/>SQLAlchemy ORM · Alembic"]
        GW --> ING --> FAC
        FAC --> AI
        FAC --> SHD
        HK --> FAC
        REST --> FAC
        FAC --> ORM
        FAC -- "commands" --> GW
    end

    subgraph DB["④ Database · Supabase"]
        POOL["Supavisor session pooler<br/>port 5432 · IPv4"]
        PG[("PostgreSQL<br/>8 tables · row-level security")]
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
    SIM -- "MQTT over TLS :8883" --> BROKER
    BROKER -- "MQTT over TLS :8883<br/>sta/v1/+/…" --> GW
    GW -- "sta/v1/&lt;id&gt;/cmd" --> BROKER
    ORM -- "PostgreSQL protocol over TLS<br/>psycopg2" --> POOL
    SPA -- "HTTPS · REST/JSON · Bearer JWT<br/>polling every 3–15 s" --> REST
    SPA -- "HTTPS map tiles" --> OSM
    OP --> SPA
    L1 -. "lab measurements<br/>μ · HVL per beam" .-> SHD

    classDef built stroke:#2ea043,stroke-width:3px
    classDef planned stroke:#d29922,stroke-width:2px,stroke-dasharray:6 4
    classDef passive stroke:#8b949e,stroke-width:2px,stroke-dasharray:2 3
    class IMU,BTN,LED,MCU,WIFI built
    class PPG,SKT,GPS,GEI,VIB,BUZ,BAT planned
    class L1,L2 passive
```

| Border | Meaning |
|---|---|
| Solid green | Built and tested (Phase 1) |
| Dashed amber | Planned hardware (Phase 2–4). The software side is already in place |
| Dotted grey | Passive protection layers (no electronics) |

**Reading the diagram:** data flows down, from the vest's sensors through the controller and the broker
into the backend and then the database. The dashboard pulls it over HTTPS. Commands flow back up:
dashboard → REST API → backend → broker → vest → LED matrix, vibration or buzzer. The protective layers
have no electronics. Their laboratory measurements feed the backend's shielding model, which the dashboard
shows on its armor page.

## 3. How data moves through the system

### 3.1 A telemetry reading (every 5 s)

1. The firmware samples the MPU-6050 over **I²C** 100 times a second and computes tilt, posture, activity,
   peak acceleration and stillness.
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

### 3.3 A command (operator → vest)

1. The operator clicks **Acknowledge** (or a command button). The browser sends `POST` over HTTPS.
2. The API checks the role, stores the command with a **correlation id** (`cid`) and publishes it to
   `sta/v1/STA-01/cmd` (**QoS 1**).
3. The vest executes it (for `ack`: "OK" on the LED matrix and a short buzz) and replies on
   `sta/v1/STA-01/resp` with the same `cid`.
4. The backend matches the reply and marks the command `acknowledged`. Without a reply within 30 s, it
   marks it `timeout`.

### 3.4 Losing a vest

When it connects, the vest registers a **Last Will** message with the broker. If power or Wi-Fi is lost,
the broker publishes `{"online": false}` on the vest's retained `status` topic. The backend marks the vest
offline at once and raises `CONTACT_LOST` after 60 s of silence. Both clear automatically when it returns.

### 3.5 With the full sensor suite

Each planned sensor follows the same path as the IMU: the controller reads it, adds a section to the
telemetry JSON, applies its own alert thresholds, and the backend's AI learns a personal baseline for it.

| Sensor | The firmware computes | Telemetry fields | Vest alerts (warning / critical) | AI on the server | Dashboard |
|---|---|---|---|---|---|
| IMU · MPU-6050 *(built)* | Tilt, posture, activity, peak g, stillness, falls | `vest_t`, `imu.*` | `FALL`, `MAN_DOWN`, `IMPACT`, `NO_MOTION`, `VEST_TEMP_HIGH` (45 / 55 °C) | `ACTIVITY_ANOMALY`, `TEMP_ANOMALY` | Posture, motion and temperature tiles, trends |
| Heart rate + SpO₂ · MAX30102 | Beats per minute and blood oxygen from red/IR light; skin contact from the IR level | `vit.hr`, `vit.spo2`, `vit.contact` | `HR_HIGH` (160 / 190 bpm), `HR_LOW` (45 / 35 bpm), `SPO2_LOW` (92 / 88 %), `SENSOR_OFF` | `HR_ANOMALY`, `SPO2_ANOMALY` | Heart-rate and SpO₂ tiles, trends |
| Skin temperature · MAX30205 | Skin temperature | `vit.skin_t` | `SKIN_TEMP_HIGH` (38 / 39 °C), `SKIN_TEMP_LOW` (30 °C) | `SKIN_TEMP_ANOMALY` | Skin-temperature tile |
| GPS · NEO-6M / NEO-M8N | Latitude, longitude, satellites, fix | `gps.fix`, `gps.lat`, `gps.lon`, `gps.sat` | `GPS_LOST` (no fix for 60 s) | | The map shows the live position instead of the assigned post |
| Radiation · Geiger (J305) | Counts per minute → dose rate (µSv/h) and accumulated dose (µSv) | `rad.cpm`, `rad.usvh`, `rad.dose` | `RAD_RATE` (1 / 10 µSv/h), `RAD_DOSE` (100 µSv per mission) | `RADIATION_ANOMALY` | Radiation tile. The armor page estimates the dose behind the Bi₂O₃ layer |
| Battery · 2S Li-ion | Voltage → charge % (6.4 V = 0 %, 8.4 V = 100 %) | `bat.v`, `bat.pct` | `BATTERY_LOW` (20 %) | | Battery tile |

The thresholds come from the prototype design (`legacy/v1-mqtt-firmware/SmartTacticalArmor/config.h`) and
will be tuned with field data. Until a sensor is fitted, its fields are absent, the vest reports it as not
fitted in its `status` message, and the dashboard shows "Not fitted · Phase N" instead of a value.

## 4. Protocols

### 4.1 Protocol on every link

| Link | Physical / network | Transport and security | Application protocol | Payload |
|---|---|---|---|---|
| MPU-6050 → RA4M1 *(built)* | I²C bus, 400 kHz, address `0x68` | none (wired in the vest) | MPU-6050 register map | 14-byte burst: accel, temperature, gyro |
| MAX30102 → RA4M1 *(Phase 2)* | Same I²C bus, address `0x57` | none | MAX30102 register map, sample FIFO | Red and IR light samples |
| MAX30205 → RA4M1 *(Phase 2)* | Same I²C bus, address `0x48` | none | MAX30205 temperature register | 16-bit temperature |
| GNSS satellites → GPS module *(Phase 3)* | Radio, GPS L1 band (1575.42 MHz) | | GNSS signals | |
| GPS module → RA4M1 *(Phase 3)* | UART `Serial1` (D0 RX / D1 TX), 9600 baud 8N1, through a level shifter | none | **NMEA 0183** sentences (GGA, RMC), about 1 per second | ASCII text |
| Geiger module → RA4M1 *(Phase 4)* | Digital pulse line to interrupt pin D2 | none | One pulse per detected particle, counted per minute (CPM) | Pulses |
| Battery → RA4M1 *(Phase 2)* | Analog voltage through a 100 kΩ / 47 kΩ divider on A0 | none | ADC reading | Voltage |
| Battery → board *(Phase 2)* | Power into VIN (6–24 V accepted) | | | 7.4 V nominal |
| RA4M1 → vibration motor / buzzer *(Phase 2)* | PWM on D5 through a logic-level MOSFET / GPIO D6 through a transistor | none | Haptic patterns from the firmware | |
| Button → RA4M1 *(built)* | GPIO D4, internal pull-up | none | debounced short press / 2 s hold | |
| RA4M1 ↔ ESP32-S3 | Internal UART on the board | none (on-board) | The WiFiS3 library's command protocol | |
| Vest → EMQX | Wi-Fi 802.11 b/g/n, 2.4 GHz, IPv4 | TCP, **TLS** (done by the ESP32-S3) | **MQTT 3.1.1**, port 8883 | JSON |
| Simulator → EMQX | Internet, IPv4 | TCP, TLS (certifi CA bundle) | MQTT 3.1.1, port 8883 | JSON |
| EMQX ↔ backend | Internet, IPv4 | TCP, TLS (certifi CA bundle) | MQTT 3.1.1, port 8883, persistent session | JSON |
| Vest clock | Wi-Fi | UDP | **SNTP**, through the Wi-Fi module (`WiFi.getTime()`) | Unix time |
| Backend → Supabase | Internet, IPv4 | TCP, TLS (`sslmode=require`) | **PostgreSQL wire protocol** via the Supavisor session pooler, port 5432 | SQL |
| Browser → dashboard host | Internet | TLS (HTTPS) | HTTP | HTML, JS, CSS |
| Browser → API | Internet | TLS (HTTPS, terminated by Render's proxy) | HTTP/1.1 **REST**, JSON, `Authorization: Bearer <JWT>` | JSON |
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
| Authentication and authorization | One username/password per client. The ACL limits each vest to its own topics |

Full message formats: [MQTT protocol](05-mqtt-protocol.md).

### 4.3 HTTP API

| Item | Value |
|---|---|
| Style | REST, resource URLs under `/api/v1`, JSON bodies, standard status codes |
| Authentication | `POST /auth/login` returns a **JWT** (HS256, 8 h). It is sent as `Authorization: Bearer …` |
| Authorization | Roles `viewer`, `operator` and `admin`, checked on every endpoint |
| Documentation | Swagger UI at `/api/v1/docs`, generated from the code by flask-restx |
| Cross-origin | CORS allows only the dashboard's origin (`CORS_ORIGINS`) |
| Live updates | The dashboard polls with TanStack Query every 3–15 s, depending on the page |

Endpoint list: [REST API reference](04-api-reference.md).

## 5. Programming languages

| Language | Version | Where it is used |
|---|---|---|
| **C++** | C++17 (GCC for Arm via the Arduino Renesas core; g++, clang++ or zig for host tests) | Vest firmware (`firmware/`), its unit tests |
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
| Own modules | `firmware/SmartTacticalArmor/src/` | MPU-6050 driver, MotionAnalyzer, FallDetector, AlertManager, AlertOutbox, SosButton, MqttLink, StatusDisplay, Haptics |
| SparkFun MAX3010x Pulse and Proximity Sensor Library | Phase 2 | MAX30102 driver and the heart-rate / SpO₂ algorithm |
| TinyGPSPlus (Mikal Hart) | Phase 3 | NMEA 0183 parser for the GPS module |
| Own small drivers | Phase 2–4 | MAX30205 (one I²C register), Geiger pulse counting (`attachInterrupt`), battery voltage (`analogRead`) |

### 6.2 Backend

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

The AI analysis (Welford and EWMA baselines, z-scores, risk fusion, priority, Beer–Lambert shielding) is
written in plain Python with no ML framework. It is fully explainable and light enough for the free tier.

### 6.3 Dashboard

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

The dashboard's own code is organised by feature, with each feature split into domain, data, application and presentation layers, plus a dependency-injection
container. Translations are built in (Arabic and English) without an i18n framework.

### 6.4 Tools

| Tool | Version | Purpose |
|---|---|---|
| Vest simulator | Python + paho-mqtt 2.2.0 | Virtual vests that speak the real protocol |
| aedes | 0.51.3 (Node.js) | Throwaway local MQTT broker for the end-to-end test |
| GitHub Actions | checkout v5, setup-python v6, setup-node v5, arduino/compile-sketches v1 | Continuous integration |
| arduino-cli / Arduino IDE | | Compiling and uploading the firmware |
| MQTTX | | Watching MQTT traffic by hand |

## 7. Hardware

### 7.1 Complete equipment list

| Equipment | Part | Measures / does | Interface | Phase |
|---|---|---|---|---|
| **Controller** | **Arduino UNO R4 WiFi**: Renesas RA4M1 (Arm Cortex-M4F, 48 MHz, 256 KB flash, 32 KB RAM) and an ESP32-S3 Wi-Fi module | Collects sensor data, runs the alert logic, sends it over Wi-Fi with TLS. The current firmware uses 38 % of flash and 35 % of RAM | | 1 · built |
| **IMU** | **MPU-6050** (GY-521 board) | 3-axis accelerometer (±16 g), 3-axis gyroscope (±2000 °/s), die temperature: falls, impacts, posture, activity, stillness, vest temperature | I²C `0x68` | 1 · built |
| **SOS / I'm OK button** | Push button | SOS (hold 2 s), "I'm OK" (short press) | GPIO D4 | 1 · built |
| **Status display** | 12×8 LED matrix on the board | Connected, pre-alert, SOS, acknowledged | On-board | 1 · built |
| **Heart rate + SpO₂** | **MAX30102** pulse oximeter | Heart rate (bpm), blood oxygen (%), skin contact | I²C `0x57` | 2 |
| **Skin temperature** | **MAX30205** clinical-grade temperature sensor (±0.1 °C) | Body (skin) temperature | I²C `0x48` | 2 |
| **Vibration motor** | Coin vibration motor + logic-level MOSFET | Silent alerts to the wearer | PWM D5 | 2 · driver ready |
| **Buzzer** | Active buzzer + transistor | Audible alerts | GPIO D6 | 2 · driver ready |
| **Battery** | 2S Li-ion pack, 7.4 V nominal (6.4–8.4 V) + 100 kΩ / 47 kΩ divider | Powers the vest; charge level for the operations room | VIN power, ADC A0 | 2 |
| **GPS** | **u-blox NEO-6M or NEO-M8N** module with antenna | Position, movement, satellites in view | UART `Serial1`, 9600 baud | 3 |
| **Radiation sensor** | **RadiationD v1.1** Geiger counter with a **J305** tube | Ambient gamma and X-ray dose rate and accumulated dose (0.00812 µSv/h per CPM, to calibrate with a known source) | Pulse output → interrupt D2 | 4 |

### 7.2 Controller pin map (complete system)

| Pin | Connected to | Notes |
|---|---|---|
| SDA / SCL (A4 / A5) or the Qwiic connector (`Wire1`) | MPU-6050 `0x68`, MAX30102 `0x57`, MAX30205 `0x48` | One shared I²C bus at 400 kHz, with no address conflicts. The MAX3010x and MAX30205 boards are 3.3 V parts: use the 3.3 V Qwiic bus or level-shifted boards |
| D0 / D1 (`Serial1` RX / TX) | GPS TX / RX | Through a level shifter |
| D2 | Geiger pulse output | Interrupt input. Leave the Geiger disabled in the firmware until it is wired, because a floating pin counts noise |
| D4 | SOS / I'm OK button to GND | Internal pull-up |
| D5 | Vibration motor (MOSFET gate) | PWM |
| D6 | Buzzer (transistor) | A GPIO pin cannot drive it directly |
| A0 | Battery divider midpoint | 100 kΩ / 47 kΩ |
| VIN / GND | 2S Li-ion pack | The board regulates it to 5 V and 3.3 V for the sensors |
| USB-C | Laptop | Programming and bench power |

### 7.3 Power

The 2S Li-ion pack feeds the board's VIN input. The board's regulator supplies 5 V and 3.3 V to the
sensors. The firmware measures the pack through the divider every 10 s, reports `bat.pct` and `bat.v`, and
raises `BATTERY_LOW` at 20 %. On USB power (no pack), the battery fields are left out.

### 7.4 Protective layers (passive)

| Layer (wearer → outside) | Material | Protects against | Data in the system |
|---|---|---|---|
| 01 Inner radiation layer | PMMA / Bi₂O₃ nanocomposite | X-ray and gamma radiation (attenuation) | The team's lab measurements (μ, HVL, mean free path for X-ray, Am-241 and Cs-137) feed the shielding model and the armor page |
| 02 Outer ballistic layer | Kevlar aramid fabric | Projectiles and fragments | Described on the armor page |

The order on the body is: wearer → Bi₂O₃ composite → Kevlar → outside. The controller, sensors and battery
sit in pouches on the carrier. The heart-rate and skin-temperature sensors sit inside the vest, against
the skin.

## 8. Cloud services and hosting

| Service | Plan | Region | Used for |
|---|---|---|---|
| **GitHub** | Free | | Source code, pull requests, GitHub Actions CI |
| **EMQX Cloud Serverless** | Free (1 GB traffic and 1 M session-minutes per month) | AWS eu-central-1 (Frankfurt) | MQTT broker |
| **Render** web service | Free (512 MB RAM, sleeps after 15 min idle) | Frankfurt | Backend API and MQTT ingestion |
| **Render** static site | Free (global CDN) | | Dashboard files |
| **Supabase** | Free (500 MB database) | Central EU (Frankfurt) | PostgreSQL |
| **OpenStreetMap** | Free tile service | | Map background |

Everything is defined as code where possible: `render.yaml` creates both Render services, Alembic
migrations create the database schema, and `.github/workflows/ci.yml` defines the CI pipeline.

## 9. Data formats and conventions

| Topic | Convention |
|---|---|
| Messages | Compact JSON on MQTT. JSON with `snake_case` fields on the REST API |
| Time | Vest: Unix epoch seconds (`ts`) and uptime (`up`). API and database: ISO 8601 in UTC. Dashboard: Asia/Riyadh time |
| Identifiers | UUIDs for database rows. `STA-01`-style codes for vests (also their MQTT username) |
| Units | °C, g (gravity), degrees, seconds, dBm, bpm, % SpO₂, WGS-84 degrees, counts per minute, µSv/h, µSv, V |
| Missing data | `null`. A sensor that is not fitted never reports a fake value |
| Severity | Vest: `1`, `2` or `3`. API: `info`, `warning` or `critical` |
| Versions | REST `/api/v1`, MQTT `sta/v1`, firmware `2.0.0`, API `1.0.0` |

## 10. Security along the chain

| Hop | Protection |
|---|---|
| Vest ↔ broker | TLS encryption. A unique username and password per vest. An ACL ([EMQX setup § 4](07-setup-emqx.md#4-authorization-acl-recommended)) restricts each vest to its own topics. Credentials live only in the git-ignored `arduino_secrets.h` |
| Broker ↔ backend | TLS with certificate verification (certifi). A dedicated `sta-backend` account |
| Backend input | Every MQTT message is validated: the `id` must match the topic, values must be within physical ranges, and unknown vests are rejected |
| Browser ↔ API | HTTPS only. JWT sessions that expire after 8 h. Role checks on every endpoint. Login lockout after 5 failures. CORS limited to the dashboard |
| API ↔ database | TLS (`sslmode=require`). Credentials in environment variables. Row-level security closes Supabase's public Data API |
| Dashboard host | `X-Frame-Options: DENY`, strict referrer policy |
| Configuration | Secrets only in environment variables or git-ignored files. Production refuses to start with development defaults |

## 11. Timing and capacity

| Item | Value |
|---|---|
| IMU sampling | 100 Hz (every 10 ms) |
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
| Heart rate + SpO₂ *(Phase 2)* | Computed over a sliding window of a few seconds of light samples |
| Battery reading *(Phase 2)* | Every 10 s |
| GPS fix *(Phase 3)* | About 1 update per second. `GPS_LOST` after 60 s without a fix |
| Radiation *(Phase 4)* | Pulses counted continuously, converted to CPM and µSv/h |
| Bandwidth, Phase 1 | About 170 bytes per telemetry message, about 250 MB per vest per month at 5 s |
| Bandwidth, full sensor suite | About 350 bytes per message, about 430 MB per vest per month at 5 s. Two vests fit the EMQX free tier at 5 s, or more vests at 10 s |

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
| Firmware | Arduino toolchain (GCC for Arm) | USB upload from a laptop | Bare-metal loop on the RA4M1, no RTOS, cooperative scheduler |
| Backend | `pip install -r requirements.txt` | Render auto-deploy after CI passes | gunicorn, 1 worker with 8 threads. The same process holds the MQTT session and the housekeeping thread |
| Dashboard | `npm ci && npm run build` (tsc + Vite) | Render auto-deploy after CI passes | Static files on a CDN, run in the browser |
| Database schema | Alembic revisions | Applied automatically when the API starts | PostgreSQL on Supabase |
