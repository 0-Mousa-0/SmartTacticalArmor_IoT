# Backend: Flask n-tier API and MQTT ingestion

The backend receives everything the vests send, analyses it, stores it in PostgreSQL (Supabase) and serves
the dashboard's REST API. It follows a strict **n-tier** structure, so every layer has one job and
depends only on the layer below it.

```mermaid
flowchart TB
    HTTP(["HTTP · React dashboard"]) --> API["api/v1<br/>flask-restx endpoints + role checks"]
    MQTT(["MQTT · vests and simulator"]) --> MSG["messaging<br/>gateway · dispatcher · housekeeper"]
    API --> F["services/facade<br/>StaFacade: one use case = one transaction"]
    MSG --> F
    F --> ING["services/ingest<br/>payload validation (anti-corruption layer)"]
    F --> AN["services/analysis<br/>anomaly · risk · priority · shielding"]
    F --> PR["services/providers<br/>CommandPublisher port"]
    F --> REPO["persistence/repositories<br/>queries only, never commit"]
    REPO --> M["models<br/>SQLAlchemy entities + enums"]
    M --> DB[("PostgreSQL (Supabase)<br/>SQLite in tests")]
    PR -. "publish cmd" .-> MSG
```

| Layer | Folder | Rule |
|---|---|---|
| Endpoints | `app/api/v1/` | Parse the HTTP request, check the role, call **one** facade method, return its result. No business logic |
| Messaging | `app/messaging/` | MQTT in and out: topic parsing, dispatch to the facade, the periodic housekeeper |
| Facade | `app/services/facade/` | Use cases (`ingest_telemetry`, `acknowledge_alert`, `send_command`, …). Each use case is **one transaction** (`with self.transaction():`). Split into mixins by domain |
| Ingest | `app/services/ingest/` | Anti-corruption layer: turns untrusted MQTT JSON into validated, bounded values |
| Analysis | `app/services/analysis/` | Pure, explainable AI: per-wearer anomaly detection, risk score, alert priority, shielding maths |
| Providers | `app/services/providers/` | Ports to the outside world (`CommandPublisher`: MQTT, null or recording for tests) |
| Persistence | `app/persistence/repositories/` | One repository per aggregate. Queries and `add()` only. **Never commits**: the facade decides |
| Models | `app/models/` | SQLAlchemy entities, enums, the alert catalogue. Portable types (UUID, JSON/JSONB, UTC timestamps) |

The design is explained with diagrams in [docs/02-uml-structural.md](../docs/02-uml-structural.md).

## Run it locally

Requires Python 3.12. On Windows, use PowerShell from the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # macOS / Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
copy .env.example .env                # then edit .env
```

For a first local run without any cloud account, set `DATABASE_URL=` to nothing in `.env`, which makes the
backend use a local SQLite file (`sta_dev.db`), and keep `MQTT_ENABLED=false`:

```powershell
flask --app wsgi db upgrade
flask --app wsgi seed-demo
flask --app wsgi create-operator admin@sta.local --name "Duty Admin" --role admin
python run.py                         # http://localhost:5000/api/v1/docs (Swagger UI)
```

To use the real database and broker, follow [Supabase setup](../docs/06-setup-supabase.md) and
[EMQX setup](../docs/07-setup-emqx.md). To see live data without hardware, run the
[simulator](../tools/simulator/README.md).

## Command-line tools

| Command | Purpose |
|---|---|
| `flask --app wsgi db upgrade` | Apply migrations |
| `flask --app wsgi db migrate -m "…"` | Generate a migration after changing a model (review it before committing) |
| `flask --app wsgi db check` | Fail if the models and migrations disagree |
| `flask --app wsgi seed-demo [--real-only]` | Demo wearers ALPHA-01…06 and vests STA-01…06 (idempotent) |
| `flask --app wsgi create-operator EMAIL --name NAME --role admin\|operator\|viewer` | Create an account (prompts for the password) |
| `flask --app wsgi register-device STA-07 [--simulated]` | Register a vest so its MQTT messages are accepted |
| `flask --app wsgi housekeeping` | Run timeouts, contact-lost detection and retention once |

## Tests and lint

```powershell
pytest                     # 69 tests on in-memory SQLite
ruff check .               # lint
$env:TEST_DATABASE_URL = "postgresql://user:pass@localhost:5432/sta_test"; pytest   # same suite on PostgreSQL
```

The tests use a recording command publisher and a controllable clock, so no broker is needed. The
end-to-end test with a real broker is in [tools/e2e](../tools/e2e/README.md).

## Configuration

Every setting is an environment variable. `.env.example` lists them all with comments.

| Variable | Default | Meaning |
|---|---|---|
| `FLASK_ENV` | `development` | `development` enables debug and allows the SQLite fallback. Render sets `production` |
| `SECRET_KEY` | (dev-only key) | Signs session tokens. **Required in production** |
| `DATABASE_URL` | SQLite file | Supabase Session pooler URI. **Required in production** |
| `CORS_ORIGINS` | `*` | The dashboard's address(es), comma-separated |
| `JWT_EXPIRES_MINUTES` | `480` | Session length |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCKOUT_SECONDS` | `5` / `300` | Brute-force protection |
| `BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` / `_NAME` | (empty) | Creates the first administrator on start-up if none exists |
| `MQTT_ENABLED` | `false` | Connect to the broker and ingest messages |
| `MQTT_HOST` / `MQTT_PORT` / `MQTT_TLS` | (empty) / `8883` / `true` | Broker address |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | (empty) | Broker account, `sta-backend` on EMQX |
| `MQTT_CLIENT_ID` | `sta-backend` | Must be unique per running backend |
| `MQTT_CLEAN_SESSION` | `false` | Persistent session: the broker queues QoS 1 alerts while the API is down |
| `MQTT_TOPIC_ROOT` | `sta/v1` | Topic prefix |
| `DEVICE_AUTO_REGISTER` | `false` | Accept messages from unknown vest codes and register them |
| `TELEMETRY_STORE_MIN_INTERVAL_S` | `5` | Store at most one telemetry row per vest per interval (alert changes always stored) |
| `TELEMETRY_RETENTION_DAYS` | `7` | Delete older telemetry |
| `CONTACT_LOST_AFTER_S` | `60` | Silence before a `CONTACT_LOST` incident |
| `COMMAND_TIMEOUT_S` | `30` | Command without a reply becomes `timeout` |
| `ANALYSIS_Z_THRESHOLD` | `3.0` | Anomaly threshold in standard deviations |
| `ANALYSIS_WARMUP_SAMPLES` | `30` | Readings needed before a wearer's baseline is trusted |
| `ANALYSIS_EWMA_ALPHA` | `0.05` | How fast the baseline adapts |
| `ANALYSIS_PERSIST_READINGS` | `3` | Consecutive anomalous readings before an alert |

## Production

`wsgi.py` is the entry point for gunicorn. `gunicorn.conf.py` runs **one worker with threads** on
purpose: that worker owns the single MQTT session and the in-memory login limiter. Deployment is described
in [docs/08-deploy-render.md](../docs/08-deploy-render.md).
