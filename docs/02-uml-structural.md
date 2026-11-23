# Structural UML

How the system is built: where each part runs, how the code is layered, and how data is stored.
Every name below matches the code. Behaviour (sequences, state machines, activities) is in
[03-uml-behavioral.md](03-uml-behavioral.md).

## Contents
1. [Deployment diagram](#1-deployment-diagram)
2. [Component diagram (backend)](#2-component-diagram-backend)
3. [Package diagrams](#3-package-diagrams)
4. [Domain model (class diagram)](#4-domain-model-class-diagram)
5. [Backend layers (class diagram)](#5-backend-layers-class-diagram)
6. [Frontend clean architecture (class diagram)](#6-frontend-clean-architecture-class-diagram)
7. [Firmware modules (class diagram)](#7-firmware-modules-class-diagram)
8. [Entity-relationship diagram](#8-entity-relationship-diagram)

---

## 1. Deployment diagram

```mermaid
flowchart TB
    subgraph VEST["«device» Smart vest"]
        direction TB
        MCU["UNO R4 WiFi<br/>RA4M1 + ESP32-S3"]
        IMU["MPU-6050<br/>I2C 0x68"]
        BTN["SOS button D4"]
        MTX["12x8 LED matrix"]
        IMU --- MCU
        BTN --- MCU
        MTX --- MCU
    end

    subgraph LAPTOP["«device» Demo laptop"]
        SIM["vest_simulator.py<br/>STA-02 to STA-06"]
    end

    subgraph EMQX["«cloud» EMQX Cloud Serverless"]
        BRK["MQTT broker<br/>TLS 8883, ACL per username"]
    end

    subgraph RENDER["«cloud» Render, Frankfurt"]
        subgraph WS["«web service» dera-sta-api, free plan"]
            GUNI["gunicorn, 1 worker, gthread"]
            APP["Flask app<br/>REST /api/v1 + Swagger"]
            GW["MqttGateway thread"]
            HK["Housekeeper thread"]
            GUNI --> APP
            APP --- GW
            APP --- HK
        end
        SITE["«static site» dera-sta-dashboard<br/>React build on CDN"]
    end

    subgraph SUPA["«cloud» Supabase, eu-central-1"]
        POOL["Supavisor session pooler 5432, IPv4"]
        PG[("PostgreSQL<br/>8 tables, RLS on")]
        POOL --> PG
    end

    BROWSER["«device» Operator browser"]

    MCU -- "MQTT 3.1.1 over TLS" --> BRK
    SIM -- "MQTT 3.1.1 over TLS" --> BRK
    GW -- "MQTT over TLS, persistent session" --> BRK
    APP -- "psycopg2, sslmode=require" --> POOL
    BROWSER -- "HTTPS GET pages" --> SITE
    BROWSER -- "HTTPS REST + Bearer JWT" --> APP
```

| Node | Runtime | Notes |
|---|---|---|
| Smart vest | Arduino C++17 (Renesas core 1.6) | 106 KB flash, 12.1 KB RAM |
| EMQX Cloud | Managed MQTT 5 / 3.1.1 broker | TLS only; free 1 GB/month |
| Render web service | Python 3.12, gunicorn 27, Flask 3.1 | Migrations run at start; health check `/api/v1/health` |
| Render static site | Vite build of React 18 | SPA rewrite `/* → /index.html` |
| Supabase | PostgreSQL via the session pooler | Render has no outbound IPv6, so the IPv4 pooler is required |

## 2. Component diagram (backend)

```mermaid
flowchart LR
    subgraph Inbound["Inbound adapters (presentation)"]
        REST["REST namespaces<br/>auth, devices, alerts, overview,<br/>analysis, armor, personnel, operators, health"]
        SEC["security.auth_required<br/>JWT + roles"]
        DISP["MessageDispatcher"]
        GW["MqttGateway (paho)"]
        HK["Housekeeper"]
    end

    subgraph Business["Business layer"]
        FAC["StaFacade<br/>one method per use case"]
        ING["ingest.payloads<br/>anti-corruption layer"]
        AN["analysis<br/>AnomalyDetector, RiskEngine,<br/>compute_priority, shielding"]
        PUB(["«port» CommandPublisher"])
    end

    subgraph Persistence["Persistence layer"]
        REPO["Repositories<br/>Operator, Personnel, Device, Telemetry,<br/>Alert, Command, Baseline"]
        ORM["SQLAlchemy models"]
    end

    DB[("PostgreSQL")]
    BROKER(["MQTT broker"])

    REST --> SEC --> FAC
    GW --> DISP --> FAC
    HK --> FAC
    FAC --> ING
    FAC --> AN
    FAC --> REPO --> ORM --> DB
    FAC --> PUB
    PUB -. "MqttCommandPublisher" .-> GW
    GW <--> BROKER
```

**Rules:**

* Inbound adapters call only the facade.
* The facade calls services, repositories and ports.
* Repositories never commit. The facade opens one transaction per use case (unit of work).

## 3. Package diagrams

### Backend (`backend/app`)

```mermaid
flowchart TB
    subgraph app["app"]
        INIT["__init__ create_app"]
        CFG["config"]
        EXT["extensions: db, migrate, cors"]
        RUN["runtime: start_background_services"]
        CLI["cli: create-operator, register-device,<br/>seed-demo, housekeeping"]
        subgraph api["api.v1"]
            NS["auth, devices, alerts, dashboard,<br/>personnel, operators, security, common"]
        end
        subgraph messaging["messaging"]
            MSG["topics, dispatcher, mqtt_gateway, housekeeper"]
        end
        subgraph services["services"]
            subgraph facade["facade"]
                FM["core, auth, operators, personnel, devices,<br/>telemetry, alerts, commands, status,<br/>overview, analysis, armor, maintenance"]
            end
            subgraph analysis["analysis"]
                AM["anomaly_detector, risk_engine,<br/>alert_priority, shielding"]
            end
            INGEST["ingest.payloads"]
            PROV["providers.command_publisher"]
        end
        subgraph persistence["persistence.repositories"]
            RP["operator, personnel, device, telemetry,<br/>alert, command, baseline"]
        end
        subgraph models["models"]
            MD["operator, personnel, device, telemetry_reading,<br/>alert, alert_event, command, metric_baseline,<br/>enums, alert_catalog, base_model"]
        end
        UT["utils: validators, tokens, rate_limit"]
    end

    api --> facade
    messaging --> facade
    facade --> analysis
    facade --> INGEST
    facade --> PROV
    facade --> persistence
    persistence --> models
    analysis --> models
```

### Frontend (`frontend/src`) — clean architecture per feature

```mermaid
flowchart TB
    subgraph appLayer["app (composition root)"]
        ROUTER["router, layout: AppShell, Sidebar, Topbar"]
        DI["di: container, DependenciesContext"]
        PRV["providers: QueryClient, I18n, Toast, Auth"]
    end
    subgraph feature["features / auth, units, alerts, overview, map,<br/>analysis, armor, fleet, settings, system"]
        PRES["presentation<br/>pages + components"]
        APPL["application<br/>React Query hooks, AuthProvider"]
        DOM["domain<br/>entities + repository interfaces + rules"]
        DATA["data<br/>DTOs, mappers, *Api repositories"]
    end
    subgraph core["core"]
        HTTP["http: HttpClient, ApiError"]
        I18N["i18n: ar, en, translate"]
        FMT["format, config, auth tokenStore"]
    end
    subgraph shared["shared"]
        UI["ui kit, charts, map, domain primitives"]
    end

    PRES --> APPL --> DOM
    DATA --> DOM
    DATA --> HTTP
    DI --> DATA
    APPL --> DI
    PRES --> UI
    PRES --> I18N
```

The dependency rule *presentation → application → domain ← data* is enforced by ESLint
(`no-restricted-imports` per layer in `frontend/eslint.config.js`).

### Firmware (`firmware/SmartTacticalArmor`)

```mermaid
flowchart LR
    INO["SmartTacticalArmor.ino<br/>composition root + scheduler"]
    subgraph pure["Hardware-independent, host-tested"]
        MOT["motion: MotionAnalyzer, FallDetector"]
        ALR["alerts: AlertManager, AlertOutbox"]
        INP["input: SosButton"]
        CORE["core: AlertTypes"]
    end
    subgraph hw["Hardware / library facing"]
        SNS["sensors: Mpu6050"]
        NET["net: MqttLink"]
        APPF["app: Payloads, CommandParser"]
        UIF["ui: StatusDisplay, Haptics, MatrixFrames"]
    end
    INO --> pure
    INO --> hw
    SNS --> MOT
    ALR --> CORE
    APPF --> CORE
```

## 4. Domain model (class diagram)

```mermaid
classDiagram
    direction LR
    class Operator {
        +UUID operator_id
        +str full_name
        +str email
        -str password_hash
        +OperatorRole role
        +bool is_active
        +datetime last_login_at
        +set_password(raw)
        +check_password(raw) bool
    }
    class Personnel {
        +UUID personnel_id
        +str callsign
        +str full_name
        +str rank
        +str unit_name
        +str blood_type
        +str zone
        +float post_lat
        +float post_lng
        +bool is_active
    }
    class Device {
        +UUID device_id
        +str device_code
        +str display_name
        +bool is_simulated
        +bool is_active
        +str firmware_version
        +dict sensors
        +int telemetry_interval_s
        +bool reported_online
        +datetime last_seen_at
        +datetime boot_at
        +dict last_telemetry
        +int risk_score
        +RiskLevel risk_level
        +list risk_reasons
    }
    class TelemetryReading {
        +int reading_id
        +datetime recorded_at
        +float vest_temp_c
        +float tilt_deg
        +Posture posture
        +float activity_g
        +float peak_g
        +int still_s
        +int alert_mask
        +bool prealert
        +int heart_rate
        +int spo2
        +float lat
        +float lng
        +float radiation_usvh
        +float anomaly_score
    }
    class Alert {
        +UUID alert_id
        +str alert_type
        +AlertSource source
        +Severity severity
        +AlertStatus status
        +int priority
        +float value
        +str message
        +dict context
        +datetime occurred_at
        +datetime acknowledged_at
        +datetime resolved_at
        +str resolution_note
        +is_open() bool
    }
    class AlertEvent {
        +int event_id
        +str kind
        +Severity severity
        +int device_seq
        +int device_uptime_s
        +str note
        +datetime received_at
    }
    class Command {
        +UUID command_id
        +CommandType command_type
        +dict params
        +str correlation_id
        +CommandStatus status
        +bool response_ok
        +str response_info
        +datetime issued_at
        +datetime completed_at
    }
    class MetricBaseline {
        +str metric
        +float mean
        +float variance
        +int samples
        +int consecutive_anomalies
        +float last_z
    }
    class Severity {
        <<enumeration>>
        INFO
        WARNING
        CRITICAL
    }
    class AlertStatus {
        <<enumeration>>
        PENDING
        OPEN
        ACKNOWLEDGED
        RESOLVED
        CLEARED
        CANCELLED
    }
    class OperatorRole {
        <<enumeration>>
        ADMIN
        OPERATOR
        VIEWER
    }

    Personnel "0..1" -- "0..1" Device : wears
    Device "1" *-- "*" TelemetryReading : records
    Device "1" *-- "*" Alert : raises
    Device "1" *-- "*" Command : receives
    Device "1" *-- "*" MetricBaseline : learns
    Alert "1" *-- "*" AlertEvent : timeline
    Personnel "0..1" -- "*" Alert : concerns
    Operator "0..1" -- "*" Alert : acknowledges and resolves
    Operator "0..1" -- "*" Command : issues
    Command "*" --> "0..1" Alert : answers
    Alert ..> Severity
    Alert ..> AlertStatus
    Operator ..> OperatorRole
```

## 5. Backend layers (class diagram)

```mermaid
classDiagram
    direction TB
    class StaFacade {
        +operators OperatorRepository
        +personnel PersonnelRepository
        +devices DeviceRepository
        +telemetry TelemetryRepository
        +alerts AlertRepository
        +commands CommandRepository
        +baselines BaselineRepository
        +anomaly_detector AnomalyDetector
        +risk_engine RiskEngine
        +publisher CommandPublisher
        +transaction() contextmanager
    }
    class TelemetryFacadeMixin {
        +ingest_telemetry(device_code, raw, received_at) dict
    }
    class AlertFacadeMixin {
        +ingest_device_alert(device_code, raw, received_at) dict
        +list_alerts(scope, severity, source, device_id) dict
        +acknowledge_alert(alert_id, operator_id, note) dict
        +resolve_alert(alert_id, operator_id, note) dict
    }
    class CommandFacadeMixin {
        +send_command(device_id, type, params, operator_id) dict
        +ingest_command_response(device_code, raw) dict
    }
    class StatusFacadeMixin {
        +ingest_status(device_code, raw, received_at, retained) dict
    }
    class MaintenanceFacadeMixin {
        +run_housekeeping(now) dict
    }
    class AuthFacadeMixin {
        +login(email, password, client_ip) dict
        +authenticate_token(token) Operator
    }
    class AnomalyDetector {
        +z_threshold float
        +warmup_samples int
        +alpha float
        +evaluate(metric, value, state) MetricEvaluation
    }
    class RiskEngine {
        +assess(inputs) RiskAssessment
    }
    class CommandPublisher {
        <<abstract>>
        +publish_command(device_code, message) bool
    }
    class MqttCommandPublisher
    class NullCommandPublisher
    class RecordingCommandPublisher
    class MqttGateway {
        +connected bool
        +start()
        +publish(topic, message, qos) bool
        +health() dict
    }
    class MessageDispatcher {
        +dispatch(topic, payload, retained, received_at) str
    }
    class Housekeeper {
        +run()
        +stop()
    }
    class AlertRepository {
        +add(alert)
        +find_open(device_id, alert_type) Alert
        +search(filter) tuple
        +device_event_exists(device_id, seq, uptime_s) bool
    }

    StaFacade --|> TelemetryFacadeMixin
    StaFacade --|> AlertFacadeMixin
    StaFacade --|> CommandFacadeMixin
    StaFacade --|> StatusFacadeMixin
    StaFacade --|> MaintenanceFacadeMixin
    StaFacade --|> AuthFacadeMixin
    StaFacade o-- AnomalyDetector
    StaFacade o-- RiskEngine
    StaFacade o-- CommandPublisher
    StaFacade o-- AlertRepository
    CommandPublisher <|-- MqttCommandPublisher
    CommandPublisher <|-- NullCommandPublisher
    CommandPublisher <|-- RecordingCommandPublisher
    MqttCommandPublisher --> MqttGateway
    MqttGateway --> MessageDispatcher
    MessageDispatcher ..> StaFacade : calls use cases
    Housekeeper ..> StaFacade : run_housekeeping
```

`StaFacade` also mixes in `FacadeCoreMixin`, `OperatorFacadeMixin`, `PersonnelFacadeMixin`, `DeviceFacadeMixin`,
`OverviewFacadeMixin`, `AnalysisFacadeMixin` and `ArmorFacadeMixin`. They are omitted above for readability.

## 6. Frontend clean architecture (class diagram)

The *units* feature is shown. Every feature follows the same shape.

```mermaid
classDiagram
    direction LR
    class Unit {
        <<entity>>
        +string id
        +string code
        +ConnectionState connection
        +LiveTelemetry telemetry
        +Wearer wearer
        +Risk risk
        +Position position
    }
    class UnitRepository {
        <<interface>>
        +list() Promise~Unit[]~
        +get(id) Promise~Unit~
        +history(id, minutes) Promise~TelemetryPoint[]~
        +commands(id) Promise~DeviceCommand[]~
        +sendCommand(id, type, params) Promise~DeviceCommand~
    }
    class unitRules {
        <<domain service>>
        +sortByPriority(units) Unit[]
        +isAtRisk(unit) boolean
        +hasSensor(unit, sensor) boolean
    }
    class UnitApi {
        <<data>>
        -http HttpClient
    }
    class mappers {
        <<data>>
        +toUnit(dto) Unit
        +toTelemetryPoint(dto) TelemetryPoint
    }
    class HttpClient {
        <<core>>
        +get(path, query) Promise
        +post(path, body) Promise
    }
    class unitHooks {
        <<application>>
        +useUnits()
        +useUnit(id)
        +useTelemetryHistory(id, minutes)
        +useSendCommand(id)
    }
    class Dependencies {
        <<composition root>>
        +units UnitRepository
        +alerts AlertRepository
        +auth AuthRepository
    }
    class UnitDetailPage {
        <<presentation>>
    }

    UnitRepository <|.. UnitApi : implements
    UnitApi --> HttpClient
    UnitApi ..> mappers
    mappers ..> Unit
    unitHooks --> UnitRepository : via useDependencies
    Dependencies o-- UnitRepository
    UnitDetailPage --> unitHooks
    UnitDetailPage ..> unitRules
```

## 7. Firmware modules (class diagram)

```mermaid
classDiagram
    direction LR
    class MotionAnalyzer {
        +setReference(gx, gy, gz, now)
        +requestRecalibration()
        +update(sample, now)
        +tiltDeg() float
        +activity() float
        +posture() Posture
        +stillMs(now) uint32
        +temperatureC() float
        +takePeak() float
    }
    class FallDetector {
        -Phase phase
        +update(accelG, tiltDeg, now) FallEvent
        +reset()
        +waiting() bool
        +peakG() float
    }
    class AlertManager {
        +setContext(context)
        +event(type, severity, value)
        +condition(type, on, severity, value, persistMs, now) ConditionChange
        +startPrealert(type, value, now) bool
        +updatePrealert(wearerOk, now) PrealertOutcome
        +escalatePrealert() bool
        +activeMask() uint32
        +highestActive() Severity
    }
    class AlertSink {
        <<interface>>
        +onAlert(message)
    }
    class AlertRouter
    class AlertOutbox~16~ {
        +push(message)
        +front() AlertMessage
        +pop()
    }
    class SosButton {
        +update(pressed, now) ButtonEvent
    }
    class Mpu6050 {
        +begin(wire, address) bool
        +read(sample) bool
        +chipName() str
    }
    class MqttLink {
        +begin(will)
        +loop(now)
        +publish(channel, payload, len, retain, qos) bool
        +takeCommand(buffer, cap, len) bool
        +epoch() uint32
    }
    class StatusDisplay {
        +showOverlay(frame, ms, now)
        +update(now, prealert, highest, linkUp)
    }
    class Haptics {
        +play(pattern, repeats, buzzer, priority)
        +stop()
        +loop(now)
    }

    AlertManager --> AlertSink
    AlertSink <|.. AlertRouter
    AlertRouter --> AlertOutbox~16~ : queues when offline
    AlertRouter --> MqttLink : publishes
    Mpu6050 ..> MotionAnalyzer : ImuSample
    MotionAnalyzer ..> FallDetector : accel, tilt
    FallDetector ..> AlertManager : FallEvent via sketch
    SosButton ..> AlertManager : SOS, I am OK
```

## 8. Entity-relationship diagram

```mermaid
erDiagram
    OPERATORS {
        uuid operator_id PK
        varchar email UK
        varchar full_name
        varchar password_hash "werkzeug scrypt"
        varchar role "admin, operator, viewer"
        bool is_active
        timestamptz last_login_at
        timestamptz created_at
        timestamptz updated_at
    }
    PERSONNEL {
        uuid personnel_id PK
        varchar callsign UK
        varchar full_name
        varchar rank
        varchar unit_name
        varchar blood_type
        varchar zone
        float post_lat
        float post_lng
        bool is_active
    }
    DEVICES {
        uuid device_id PK
        varchar device_code UK "MQTT id, e.g. STA-01"
        uuid personnel_id FK, UK "one vest per wearer"
        varchar display_name
        bool is_simulated
        bool is_active
        varchar firmware_version
        jsonb sensors
        int telemetry_interval_s
        bool reported_online
        timestamptz last_seen_at
        timestamptz boot_at
        jsonb last_telemetry "live snapshot"
        int risk_score
        varchar risk_level
        jsonb risk_reasons
    }
    TELEMETRY_READINGS {
        bigint reading_id PK
        uuid device_id FK
        timestamptz recorded_at "indexed with device_id"
        int seq
        float vest_temp_c
        float tilt_deg
        varchar posture
        float activity_g
        float peak_g
        int still_s
        int alert_mask
        bool prealert
        int heart_rate "phase 2"
        int spo2 "phase 2"
        float lat "phase 3"
        float lng "phase 3"
        float radiation_usvh "phase 4"
        float anomaly_score
    }
    ALERTS {
        uuid alert_id PK
        uuid device_id FK
        uuid personnel_id FK
        varchar alert_type
        varchar source "device, analysis"
        varchar severity
        varchar status
        int priority
        float value
        jsonb context
        timestamptz occurred_at
        uuid acknowledged_by FK
        uuid resolved_by FK
        varchar resolution_note
    }
    ALERT_EVENTS {
        bigint event_id PK
        uuid alert_id FK
        uuid device_id FK
        varchar kind
        int device_seq "UK with device_id, device_uptime_s"
        int device_uptime_s
        uuid actor_operator_id FK
        jsonb payload
        timestamptz received_at
    }
    COMMANDS {
        uuid command_id PK
        uuid device_id FK
        uuid issued_by FK
        uuid alert_id FK
        varchar command_type
        jsonb params
        varchar correlation_id UK "cid echoed by the vest"
        varchar status
        bool response_ok
        varchar response_info
        timestamptz issued_at
        timestamptz completed_at
    }
    METRIC_BASELINES {
        bigint baseline_id PK
        uuid device_id FK
        varchar metric "UK with device_id"
        float mean
        float variance
        int samples
        int consecutive_anomalies
        float last_z
    }

    PERSONNEL |o--o| DEVICES : "wears"
    DEVICES ||--o{ TELEMETRY_READINGS : "records"
    DEVICES ||--o{ ALERTS : "raises"
    DEVICES ||--o{ COMMANDS : "receives"
    DEVICES ||--o{ METRIC_BASELINES : "learns"
    ALERTS ||--o{ ALERT_EVENTS : "timeline"
    PERSONNEL |o--o{ ALERTS : "concerns"
    OPERATORS |o--o{ ALERTS : "acknowledges"
    OPERATORS |o--o{ COMMANDS : "issues"
    OPERATORS |o--o{ ALERT_EVENTS : "acts"
    ALERTS |o--o{ COMMANDS : "answered by"
```

**Storage notes:**

* Column types are portable: `UUIDType`, `JSONType` (JSONB on Postgres) and `UTCDateTime`. The same models run
  on SQLite in tests.
* `telemetry_readings` is down-sampled (every 5 s at most, plus every alert change) and purged after 7 days.
* The `uq_alert_events_device_message` constraint makes alert ingestion idempotent under MQTT QoS 1 redelivery.
* Migration `0002_enable_rls` enables Row-Level Security on every table (Supabase Data API hardening).
