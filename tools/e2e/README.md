# End-to-end test (simulator → MQTT → backend → API)

This test exercises the whole chain on a laptop: virtual vests publish over MQTT to a local broker, the
real Flask backend ingests the messages, and a checker drives the REST API like the dashboard does.
No cloud account is needed.

It is the test that found two real defects before release: the AI baseline adapted too fast, and a fast
command reply could be lost. Both are fixed and covered by unit tests. See `docs/09-scm-and-qa.md`.

## Run it

Open four terminals from the repository root.

```sh
# 1) local MQTT broker on 127.0.0.1:18830 (first time: npm install)
cd tools/e2e && npm install && npm run broker

# 2) backend with MQTT ingestion, on a fresh SQLite file
cd backend
export FLASK_ENV=development DATABASE_URL=sqlite:///$PWD/e2e.db
flask --app wsgi db upgrade && flask --app wsgi seed-demo
flask --app wsgi create-operator viewer@sta.local --name "Judge Viewer" --role viewer --password Viewer-Demo-2026
export MQTT_ENABLED=true MQTT_HOST=127.0.0.1 MQTT_PORT=18830 MQTT_TLS=false MQTT_USERNAME= \
       MQTT_CLIENT_ID=sta-backend-e2e CONTACT_LOST_AFTER_S=15 ANALYSIS_WARMUP_SAMPLES=20 \
       HOUSEKEEPING_INTERVAL_S=5 BOOTSTRAP_ADMIN_EMAIL=admin@sta.local \
       BOOTSTRAP_ADMIN_PASSWORD=Admin-Demo-2026 PORT=5055
python run.py

# 3) six virtual vests, scripted demo at 4x speed
cd tools/simulator
python vest_simulator.py --host 127.0.0.1 --port 18830 --no-tls \
  --devices STA-01,STA-02,STA-03,STA-04,STA-05,STA-06 --interval 1 --demo --demo-speed 4 --no-console

# 4) the checker (~2.5 minutes)
python tools/e2e/e2e_check.py
```

## Expected result

```
  [PASS] backend connected to the MQTT broker
  [PASS] bootstrap admin can sign in
  [PASS] all six vests report online through MQTT
  [PASS] ping published to STA-02
  [PASS] vest answered 'pong' with the correlation id
  [PASS] interval command changed the vest report interval to 2 s
  [PASS] viewer role cannot send commands (403)
  [PASS] STA-02 fall: pending -> critical after 10 s without answer
  [PASS] operator acknowledged the fall and the vest was notified
  [PASS] fall timeline ['pending', 'escalated', 'acknowledged']
  [PASS] AI analysis flagged STA-03's abnormal temperature rise (below the vest's own threshold)
  [PASS] STA-04 heat condition alert raised by the vest
  [PASS] SOS ranked at the top of the priority queue
  [PASS] STA-05 dropped off-air -> Last Will + CONTACT_LOST alert
  [PASS] overview counts the critical incidents
  [PASS] contact-lost alert cleared automatically when STA-05 came back
  [PASS] per-wearer baseline learned from live telemetry
  [PASS] telemetry history stored
RESULT: ALL CHECKS PASSED
```

With the stack still running, start the dashboard against it to see everything live:

```sh
cd frontend && VITE_API_BASE_URL=http://127.0.0.1:5055/api/v1 npm run dev   # sign in as admin@sta.local
```
