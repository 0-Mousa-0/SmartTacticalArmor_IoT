# Behavioral UML

How the system behaves at run time: who uses it, how messages flow, and the life cycle of the
main objects. Every step names the real method, topic or endpoint. Structure is in
[02-uml-structural.md](02-uml-structural.md).

## Contents
1. [Use case diagram](#1-use-case-diagram)
2. [Sequence diagrams](#2-sequence-diagrams)
   - 2.1 [Telemetry ingestion and AI analysis](#21-telemetry-ingestion-and-ai-analysis)
   - 2.2 [Fall: pre-alert, escalation, acknowledgement](#22-fall-pre-alert-escalation-acknowledgement)
   - 2.3 [Operator command with correlation id](#23-operator-command-with-correlation-id)
   - 2.4 [Vest start-up, Last Will and lost contact](#24-vest-start-up-last-will-and-lost-contact)
   - 2.5 [Operator sign-in and a role-protected request](#25-operator-sign-in-and-a-role-protected-request)
   - 2.6 [Dashboard live refresh](#26-dashboard-live-refresh)
3. [State machines](#3-state-machines)
   - 3.1 [Firmware fall detector](#31-firmware-fall-detector)
   - 3.2 [Incident (alert) life cycle](#32-incident-alert-life-cycle)
   - 3.3 [Command life cycle](#33-command-life-cycle)
   - 3.4 [Vest connectivity](#34-vest-connectivity)
4. [Activity diagrams](#4-activity-diagrams)
   - 4.1 [Firmware main loop](#41-firmware-main-loop)
   - 4.2 [AI analysis of one telemetry message](#42-ai-analysis-of-one-telemetry-message)

---

## 1. Use case diagram

**1a. Operations room**: the people who use the dashboard.

```mermaid
flowchart LR
    J(["Viewer / judge"])
    O(["Operator<br/>+ all viewer use cases"])
    A(["Administrator<br/>+ all operator use cases"])

    subgraph ROOM["Dera command and control: dashboard"]
        UC16(["Sign in"])
        UC5(["Monitor units live:<br/>overview, map, unit detail"])
        UC6(["Review prioritized incidents"])
        UC15(["Explore shielding performance"])
        UC7(["Acknowledge an incident"])
        UC8(["Resolve an incident"])
        UC9(["Send command to a vest"])
        UC13(["Manage vests and wearers"])
        UC14(["Manage operator accounts"])
    end

    J --- UC16
    J --- UC5
    J --- UC6
    J --- UC15
    O --- UC7
    O --- UC8
    O --- UC9
    A --- UC13
    A --- UC14
    UC7 -. "«include»" .-> UC9
```

**1b. Vest and automated analysis**: the wearer, the vest firmware and the server-side AI.

```mermaid
flowchart LR
    W(["Field member<br/>(wearer)"])

    subgraph FIELD["Dera command and control: vest and analysis"]
        UC4(["Raise SOS"])
        UC3(["Cancel a pre-alert: I am OK"])
        UC2(["Detect fall, impact, man down"])
        UC1(["Report telemetry"])
        UC10(["Learn baselines,<br/>detect anomalies"])
        UC11(["Rank units by risk"])
        UC12(["Detect lost contact"])
    end

    VEST(["«system»<br/>Vest firmware"])
    AI(["«system»<br/>AI analysis"])

    W --- UC4
    W --- UC3
    UC3 -. "«extend»" .-> UC2
    UC2 --- VEST
    UC1 --- VEST
    UC10 --- AI
    UC11 --- AI
    UC12 --- AI
```

The roles are cumulative: an operator can do everything a viewer can, and an administrator everything
an operator can. The API enforces this with the `viewer`, `operator` and `admin` roles. «include»:
acknowledging an incident always sends the `ack` command to the vest. «extend»: the wearer's "I am OK" is
an optional extension of fall detection.

| Actor | Role in the system | Permissions |
|---|---|---|
| Field member | Wears the vest; can raise SOS or cancel a suspected fall | Physical button only |
| Operator | Watches the operations room, handles incidents, sends commands | `operator` role |
| Administrator | Everything an operator can do, plus fleet and account management | `admin` role |
| Viewer / judge | Read-only access for supervisors or competition judges | `viewer` role |
| Vest firmware | Sensing, local alert logic, MQTT client | Per-device MQTT credentials |
| AI analysis | Server-side anomaly detection, risk fusion, contact-lost detection | Runs inside the backend |

## 2. Sequence diagrams

### 2.1 Telemetry ingestion and AI analysis

```mermaid
sequenceDiagram
    autonumber
    participant V as Vest firmware
    participant B as EMQX broker
    participant G as MqttGateway
    participant D as MessageDispatcher
    participant F as StaFacade
    participant P as ingest.payloads
    participant AD as AnomalyDetector
    participant R as Repositories
    participant RE as RiskEngine
    participant DB as PostgreSQL

    V->>B: PUBLISH sta/v1/STA-01/telemetry, QoS 0, every 5 s
    B->>G: deliver message
    G->>D: dispatch(topic, payload, retained=false)
    D->>F: ingest_telemetry(STA-01, data, received_at)
    F->>P: parse_telemetry() validates and bounds every field
    P-->>F: TelemetryPayload
    F->>R: devices.get_by_code(STA-01)
    F->>F: _mark_seen() updates last_seen and boot_at
    loop each metric present: vest_temp_c, activity_g
        F->>R: baselines.get_or_create(device, metric)
        F->>AD: evaluate(metric, value, baseline)
        AD-->>F: z-score, is_anomaly, consecutive
        alt anomalous for 3 readings in a row
            F->>R: open or refresh analysis alert, e.g. TEMP_ANOMALY
        else back within baseline
            F->>R: clear that analysis alert
        end
    end
    opt 5 s since the last stored sample, or the alert mask changed
        F->>R: telemetry.add(TelemetryReading)
    end
    F->>R: clear CONTACT_LOST if it was open
    F->>RE: assess(open alerts, posture, stillness, heat, anomalies)
    RE-->>F: score 0-100, level, factors
    F->>DB: COMMIT, one transaction for the whole message
```

### 2.2 Fall: pre-alert, escalation, acknowledgement

```mermaid
sequenceDiagram
    autonumber
    actor W as Wearer
    participant V as Vest firmware
    participant B as EMQX broker
    participant API as Backend (StaFacade)
    participant UI as Dashboard
    actor O as Operator

    V->>V: FallDetector: free fall, impact, lying for 2.5 s
    V->>B: alert FALL, state pending, sev 1
    V-->>W: blinking ! and vibration: press if you are OK
    B->>API: ingest_device_alert(): new incident, status PENDING
    alt wearer presses the button within 10 s
        W->>V: short press
        V->>B: alert FALL, state cancelled
        B->>API: incident status CANCELLED
    else no answer within 10 s
        V->>B: alert FALL, state event, sev 3
        B->>API: escalate: status OPEN, severity critical, priority up
        API->>API: RiskEngine: risk 100 critical
        UI->>API: GET /alerts?scope=open (poll every 5 s)
        API-->>UI: FALL is first in the priority queue
        O->>UI: Acknowledge, note: medic dispatched
        UI->>API: POST /alerts/{id}/acknowledge
        API->>API: status ACKNOWLEDGED, event logged
        API->>B: PUBLISH sta/v1/STA-01/cmd: ack FALL, cid
        B->>V: command ack
        V-->>W: OK on the LED matrix, two short buzzes
        V->>B: resp: ack ok, cid
        B->>API: command ACKNOWLEDGED
        O->>UI: Resolve, note: wearer evacuated
        UI->>API: POST /alerts/{id}/resolve
        API-->>UI: status RESOLVED, timeline complete
    end
```

### 2.3 Operator command with correlation id

```mermaid
sequenceDiagram
    autonumber
    actor O as Operator
    participant UI as Dashboard
    participant API as REST API
    participant F as StaFacade
    participant PUB as MqttCommandPublisher
    participant B as EMQX broker
    participant V as Vest firmware
    participant HK as Housekeeper

    O->>UI: Report interval: every 2 s
    UI->>API: POST /devices/{id}/commands, interval, sec 2
    API->>API: auth_required(operator, admin)
    API->>F: send_command(device, interval, sec 2, operator)
    F->>F: validate params, store Command QUEUED, cid = 8 hex chars
    F->>PUB: publish_command(STA-01, cmd interval, cid, sec 2)
    PUB->>B: PUBLISH sta/v1/STA-01/cmd, QoS 1
    alt broker accepted
        F->>F: status SENT unless a reply already arrived
        API-->>UI: 201, status sent
        B->>V: command
        V->>V: telemetryPeriodMs = 2000
        V->>B: resp: cmd interval, ok true, cid
        B->>F: ingest_command_response(): match by cid
        F->>F: status ACKNOWLEDGED, device interval 2 s
    else broker not connected
        F->>F: status FAILED, channel offline
        API-->>UI: 201, status failed, toast shows the reason
    end
    opt no reply within 30 s
        HK->>F: run_housekeeping(): status TIMEOUT
    end
```

### 2.4 Vest start-up, Last Will and lost contact

```mermaid
sequenceDiagram
    autonumber
    participant V as Vest firmware
    participant B as EMQX broker
    participant API as Backend
    participant HK as Housekeeper

    V->>V: setup(): I2C scan, MPU-6050 init, 1 s upright calibration
    V->>B: CONNECT over TLS, user STA-01, Will: status online false, retained
    B-->>V: CONNACK
    V->>B: SUBSCRIBE sta/v1/STA-01/cmd
    V->>B: PUBLISH status online true, fw, sensors, retained
    B->>API: ingest_status(): firmware, sensors, interval recorded
    loop every 5 s
        V->>B: telemetry
        B->>API: ingest_telemetry(): connection online
    end
    Note over V,B: battery pulled or Wi-Fi lost, no clean disconnect
    B->>API: Last Will: status online false
    API->>API: connection offline, risk factor contact lost
    HK->>API: run_housekeeping() after 60 s of silence
    API->>API: raise CONTACT_LOST alert from analysis, severity warning
    V->>B: reconnects later, status online true
    B->>API: telemetry resumes, CONTACT_LOST cleared automatically
```

### 2.5 Operator sign-in and a role-protected request

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant UI as Dashboard
    participant API as REST API
    participant F as StaFacade
    participant DB as PostgreSQL

    U->>UI: email and password
    UI->>API: POST /auth/login
    API->>F: login(email, password, client_ip)
    F->>F: LoginRateLimiter: 5 failures, 5 min lockout
    F->>DB: operator by email
    alt valid and active
        F->>F: check_password(), issue JWT HS256, 8 h
        F-->>UI: 200, access_token, operator, role
        UI->>UI: tokenStore.set(), navigate to the overview
    else wrong credentials
        F-->>UI: 401 Invalid email or password
    end
    UI->>API: POST /devices/{id}/commands with Bearer token
    API->>F: authenticate_token(): signature, expiry, account still active
    alt role is viewer
        API-->>UI: 403 Your role does not allow this action
    else operator or admin
        API->>F: send_command(...)
    end
    Note over UI: any 401 clears the session and returns to the login page
```

### 2.6 Dashboard live refresh

```mermaid
sequenceDiagram
    autonumber
    participant P as UnitDetailPage
    participant H as useUnit hook (React Query)
    participant R as UnitRepository (UnitApi)
    participant C as HttpClient
    participant API as REST API

    P->>H: useUnit(id)
    loop every 3 s while the page is open
        H->>R: get(id)
        R->>C: get(/devices/id)
        C->>API: GET with Authorization Bearer
        API-->>C: device view JSON (snake_case)
        C-->>R: payload
        R-->>H: toUnit(dto) domain entity
        H-->>P: re-render sensors, risk and position
    end
    Note over P,H: the page depends on the UnitRepository interface only, tests inject a fake
```

## 3. State machines

### 3.1 Firmware fall detector

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> POST_IMPACT : a >= 6 g, report IMPACT, cause hard hit
    IDLE --> FREEFALL : a < 0.45 g for 60 ms
    FREEFALL --> POST_IMPACT : a >= 2.5 g, cause free fall
    FREEFALL --> IDLE : no impact within 1 s
    POST_IMPACT --> WAITING : after 2.5 s, tilt >= 55 deg
    POST_IMPACT --> IDLE : after 2.5 s, upright again
    WAITING --> IDLE : reset() after the pre-alert is cancelled or escalated

    state WAITING {
        [*] --> Prealert
        Prealert : FALL if free fall came first
        Prealert : MAN_DOWN if a hard hit came first
        Prealert --> Cancelled : short press within 10 s
        Prealert --> Escalated : 10 s without answer, or SOS
    }
```

### 3.2 Incident (alert) life cycle

```mermaid
stateDiagram-v2
    [*] --> PENDING : vest pre-alert
    [*] --> OPEN : event or active condition, or AI finding
    PENDING --> OPEN : escalated by the vest
    PENDING --> CANCELLED : wearer pressed I am OK
    OPEN --> ACKNOWLEDGED : operator acknowledges, vest notified
    ACKNOWLEDGED --> OPEN : escalated to critical, needs a new acknowledgement
    OPEN --> CLEARED : condition ended or AI back to baseline
    ACKNOWLEDGED --> CLEARED : condition ended
    OPEN --> RESOLVED : operator resolves with a note
    ACKNOWLEDGED --> RESOLVED : operator resolves with a note
    PENDING --> RESOLVED : operator resolves
    RESOLVED --> [*]
    CLEARED --> [*]
    CANCELLED --> [*]

    note right of OPEN
        priority = base(type) x severity x status
        plus up to 10 points for age
    end note
```

### 3.3 Command life cycle

```mermaid
stateDiagram-v2
    [*] --> QUEUED : send_command() stores it
    QUEUED --> SENT : broker accepted the publish
    QUEUED --> FAILED : MQTT not connected
    QUEUED --> ACKNOWLEDGED : fast reply before the send step finished
    SENT --> ACKNOWLEDGED : resp ok true, matched by cid
    SENT --> FAILED : resp ok false
    SENT --> TIMEOUT : no reply within 30 s
    TIMEOUT --> ACKNOWLEDGED : late reply
    ACKNOWLEDGED --> [*]
    FAILED --> [*]
    TIMEOUT --> [*]
```

### 3.4 Vest connectivity

```mermaid
stateDiagram-v2
    state "Firmware MqttLink" as FW {
        [*] --> NET_NO_WIFI
        NET_NO_WIFI --> NET_NO_MQTT : WiFi.begin() succeeded
        NET_NO_MQTT --> NET_OK : TLS connect + CONNACK, subscribe cmd, publish status
        NET_OK --> NET_NO_MQTT : broker connection lost, retry every 5 s
        NET_NO_MQTT --> NET_NO_WIFI : Wi-Fi lost, retry every 10 s
        NET_OK --> NET_NO_WIFI : Wi-Fi lost
    }
    state "Backend view of a device" as BE {
        [*] --> never
        never --> online : first telemetry or status
        online --> offline : Last Will received, or silent for max(20 s, 3 x interval)
        offline --> online : telemetry resumes
    }
```

## 4. Activity diagrams

### 4.1 Firmware main loop

```mermaid
flowchart TD
    START([loop]) --> CTX["alerts.setContext(uptime, epoch, tilt, temperature)"]
    CTX --> LINK["link.loop(): Wi-Fi and MQTT reconnect, poll"]
    LINK --> JC{"just connected?"}
    JC -- yes --> ST["publish retained status, show OK"]
    JC -- no --> OB
    ST --> OB["flush up to 3 queued alerts"]
    OB --> IMUQ{"10 ms since last IMU read?"}
    IMUQ -- yes --> IMU["imu.read, motion.update, fall.update"]
    IMU --> FE{"fall event?"}
    FE -- IMPACT --> EV["alerts.event IMPACT warning"]
    FE -- FALL or MAN_DOWN --> PA["alerts.startPrealert, vibrate"]
    FE -- none --> BTN
    EV --> BTN
    PA --> BTN
    IMUQ -- no --> BTN["button.update: long = SOS, short = I am OK or silence"]
    BTN --> PRE["prealertTask: cancelled or escalated after 10 s"]
    PRE --> HAP["haptics.loop"]
    HAP --> RULQ{"1 s since last rules?"}
    RULQ -- yes --> RUL["rules: NO_MOTION, VEST_TEMP_HIGH with persistence"]
    RULQ -- no --> CMD
    RUL --> CMD["commandTask: parse, execute, resp with cid"]
    CMD --> TELQ{"telemetry period elapsed?"}
    TELQ -- yes --> TEL["publish telemetry JSON"]
    TELQ -- no --> UIQ
    TEL --> UIQ{"250 ms since last UI update?"}
    UIQ -- yes --> UI["LED matrix by priority"]
    UIQ -- no --> END([next loop])
    UI --> END
```

### 4.2 AI analysis of one telemetry message

```mermaid
flowchart TD
    A([telemetry received]) --> B["metrics present: vest_temp_c, activity_g; later heart_rate, spo2, skin_temp_c, radiation_usvh"]
    B --> C{"for each metric"}
    C --> D["load baseline: mean, variance, samples, consecutive"]
    D --> E{"samples >= warm-up of 30?"}
    E -- no --> F["learn with Welford, no verdict"]
    E -- yes --> G["z = (x - mean) / max(std, noise floor)"]
    G --> H{"beyond 3 sigma in the risky direction?"}
    H -- yes --> I["anomaly: consecutive + 1<br/>mean drifts at alpha/5, spread unchanged"]
    H -- no --> J["normal: consecutive = 0<br/>EWMA update of mean and variance"]
    I --> K{"consecutive >= 3?"}
    K -- yes --> L["open or refresh analysis alert<br/>with value, usual value and z"]
    K -- no --> M
    J --> N["clear the analysis alert if open"]
    N --> M
    F --> M
    L --> M["store anomaly_score = max abs z"]
    M --> C
    C -- done --> R["RiskEngine.assess: strongest incident + 15% of others<br/>+ pre-alert, contact, posture, stillness, heat, anomalies"]
    R --> S["save risk score, level and factors on the device"]
    S --> T([dashboard ranks units by risk])
```
