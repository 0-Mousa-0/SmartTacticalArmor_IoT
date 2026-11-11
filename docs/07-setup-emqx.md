# EMQX Cloud setup: the MQTT broker

Vests and virtual vests publish to an MQTT broker. The backend subscribes to the same broker and sends
commands back through it. This project uses **EMQX Cloud Serverless**, whose free quota is enough for a
prototype and demos. (HiveMQ Cloud's free Serverless plan no longer accepts new clusters and shuts down
at the end of 2026, which is why the earlier prototype's broker was replaced.)

> **What the project needs from you:** the broker **address** and **three username/password pairs**.
> Setup takes about 10 minutes.

| Username | Used by | The password goes into |
|---|---|---|
| `sta-backend` | Flask API | `backend/.env` → `MQTT_PASSWORD`, and Render → `MQTT_PASSWORD` |
| `STA-01` | The real vest (UNO R4 WiFi) | `firmware/SmartTacticalArmor/arduino_secrets.h` → `SECRET_MQTT_PASS` |
| `sta-simulator` | Virtual vests STA-02 … STA-06 | `tools/simulator/.env` → `SIM_MQTT_PASSWORD` |

## 1. Create the deployment

1. Go to <https://www.emqx.com/en/cloud> → **Get Started Free** and create an account.
2. In the console: **New Deployment** → **Serverless**.
3. Choose the region closest to the Render API, ideally **Frankfurt (eu-central-1)**, or another
   European region.
4. Leave the **spending limit at $0**. You can never be charged; if the free quota runs out, the
   deployment is restricted until next month.
5. Click **Deploy**. The deployment is ready in about a minute.

Free quota per month: **1 GB of traffic and 1 million session-minutes**. That is enough for the real vest
around the clock plus demos with the simulator. See the [bandwidth budget](05-mqtt-protocol.md#10-bandwidth-budget).

## 2. Note the connection details

Open the deployment's **Overview** page:

| Field | Example | Where it goes |
|---|---|---|
| Address | `ab12cd34.ala.eu-central-1.emqxsl.com` | `MQTT_HOST` (backend and Render), `MQTT_HOST` in `firmware/…/config.h`, `SIM_MQTT_HOST` |
| MQTT over TLS/SSL port | `8883` | Already the default everywhere |
| CA certificate | DigiCert Global Root G2 | Not needed: the backend and simulator use the `certifi` trust store, and the UNO R4's Wi-Fi module already trusts this root |

Write the address **without** `mqtts://` or a port.

## 3. Create the accounts (Authentication)

**Access Control → Authentication → Add**, three times:

1. `sta-backend` with a long random password
2. `STA-01` with a different password. The username must equal `DEVICE_ID` in `config.h`
3. `sta-simulator` with a third password

Every additional real vest gets its own account (`STA-07`, …) with the same name as its `DEVICE_ID`.

## 4. Authorization (ACL), recommended

By default, EMQX Serverless lets any authenticated client publish and subscribe to any topic. Once
everything works, restrict each account to its own topics. Use **Access Control → Authorization → Add**:

| Scope | Who | Topic | Action | Permission |
|---|---|---|---|---|
| Username | `sta-backend` | `sta/v1/#` | Publish & Subscribe | Allow |
| Username | `sta-simulator` | `sta/v1/#` | Publish & Subscribe | Allow |
| Username | `STA-01` | `sta/v1/STA-01/#` | Publish & Subscribe | Allow |
| All Users | | `#` | Publish & Subscribe | **Deny** |

EMQX checks Username and Client ID rules first and the All Users rules last. The final deny therefore
blocks everything that was not explicitly allowed: a vest cannot read other vests' data or send commands
to them. Add one Username rule for each new vest.

## 5. Test the broker before wiring anything

1. Install [MQTTX](https://mqttx.app), EMQX's free desktop client.
2. Create a connection with **Host** `mqtts://<address>`, **Port** `8883`, **SSL/TLS** on, **Username**
   `sta-backend` and its password. Connect.
3. Subscribe to `sta/v1/#`.
4. Start the simulator ([its README](../tools/simulator/README.md)) or power the vest. Messages appear in
   MQTTX within seconds.

## 6. Fill in the values

```ini
# backend/.env (local development against the real broker)
MQTT_ENABLED=true
MQTT_HOST=ab12cd34.ala.eu-central-1.emqxsl.com
MQTT_USERNAME=sta-backend
MQTT_PASSWORD=<sta-backend password>
MQTT_CLIENT_ID=sta-backend-local   # see the warning below
```

```cpp
// firmware/SmartTacticalArmor/config.h
#define MQTT_HOST "ab12cd34.ala.eu-central-1.emqxsl.com"

// firmware/SmartTacticalArmor/arduino_secrets.h  (git-ignored)
#define SECRET_MQTT_USER "STA-01"
#define SECRET_MQTT_PASS "<STA-01 password>"
```

```ini
# tools/simulator/.env (git-ignored)
SIM_MQTT_HOST=ab12cd34.ala.eu-central-1.emqxsl.com
SIM_MQTT_USERNAME=sta-simulator
SIM_MQTT_PASSWORD=<sta-simulator password>
```

In Render, set `MQTT_HOST` and `MQTT_PASSWORD` on the API service. `render.yaml` already sets
`MQTT_USERNAME=sta-backend` and `MQTT_CLIENT_ID=sta-backend`.

> **Run only one backend per broker.** A second backend that connects with the same client id
> disconnects the first. With a different client id, both would ingest every message into the database.
> While the Render API is live, run your local backend with `MQTT_ENABLED=false`, or point it at the
> local test broker in `tools/e2e`.

## 7. Monitoring

The deployment's **Overview** and **Metrics** pages show connected clients, message rates and the
monthly usage. When the system is healthy, the backend appears as `sta-backend`, the vest as `STA-01`
and each virtual vest as `STA-0x-sim`.

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Not authorized` / return code 4 or 5 | Wrong username or password, or the account does not exist. Usernames are case-sensitive (`STA-01`) |
| Backend health shows `"mqtt": {"connected": false}` | Check `MQTT_ENABLED=true`, `MQTT_HOST` (no `mqtts://`), port 8883 and the password. Render logs show the reason |
| Vest prints `[MQTT] Connecting…` repeatedly | Update the Wi-Fi module firmware (Arduino IDE → Tools → Firmware Updater). Check `MQTT_HOST` and the `STA-01` credentials |
| Messages appear in MQTTX, but the dashboard shows nothing | The vest is not registered. Add `STA-01` on the dashboard's **Fleet** page, or run `flask --app wsgi seed-demo` |
| Commands time out | ACL: the vest must be allowed to subscribe to `sta/v1/STA-01/cmd` |
| Connections stop near the end of the month | Free quota used up. Check usage on the Overview page. Use longer intervals and run the simulator only for demos |
