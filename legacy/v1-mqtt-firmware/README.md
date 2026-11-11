# Smart Tactical Armor — IoT firmware (Arduino UNO R4 WiFi)

## Stage 1 quick start (board + IMU only) — this is the default config
1. **Wire the IMU (GY-521 / MPU-6050)** with jumper wires:
   VCC → 5V, GND → GND, SDA → SDA (A4), SCL → SCL (A5). Leave XDA, XCL, AD0, INT unconnected.
   (Qwiic cable instead? set `IMU_ON_QWIIC 1` in config.h.)
2. Optional SOS test button: a jumper wire on **D4** — touch it to GND briefly = "I'm OK", hold 2 s = SOS.
3. Libraries needed now: **ArduinoMqttClient** and **ArduinoJson** only.
4. `arduino_secrets.h`: Wi-Fi name and password. The UNO R4 WiFi joins **2.4 GHz** networks only.
5. Upload, open Serial Monitor at **115200**. Expect `[I2C] ... 0x68`, `[IMU] MPU-6050 OK`, then a JSON line every 2 s.
6. **At power-on hold the IMU upright and still for 1 s**, in the same orientation it will have on the vest
   (that pose becomes "standing"). Redo anytime with the command `{"cmd":"calibrate"}`.
7. See the data online: install **MQTT Explorer**, connect to `test.mosquitto.org` port 1883,
   open `sta/v1/STA-01/`. Public broker = test data only; anyone can read it.

Stage 1 demo moves:
| Do this | You get |
|---|---|
| Drop the IMU onto a cushion and leave it lying | `FALL` pending → blinking "!" → CRITICAL after 10 s |
| Same, then tap D4 to GND within 10 s | `FALL` cancelled |
| Sharp knock on the IMU | `IMPACT` (above 6 g) |
| Hold D4 to GND for 2 s | `SOS` critical |
| Hair dryer on the IMU | `VEST_TEMP_HIGH` warning at 45 °C, critical at 55 °C |
| Leave it untouched for 60 s | `NO_MOTION` warning |
| Publish `{"cmd":"ack","type":"FALL"}` to `sta/v1/STA-01/cmd` | "OK" on the LED matrix |

The IMU temperature is the chip's own temperature (reads a few °C above the air). Present it as
vest / environment temperature, not body temperature.

As parts arrive, set `HAS_PPG`, `HAS_SKIN_TEMP`, `HAS_GPS`, `HAS_GEIGER`, `HAS_BATTERY` to 1 in config.h.

## Folder
| Path | What it is |
|---|---|
| `SmartTacticalArmor/` | The Arduino sketch. Open `SmartTacticalArmor.ino` in the Arduino IDE. |
| `SmartTacticalArmor/config.h` | Device ID, broker IP, pins, thresholds, timing. |
| `SmartTacticalArmor/arduino_secrets.h` | Wi-Fi and MQTT passwords (don't share). |
| `ops_room/` | Mosquitto broker config + ACL for the ops-room laptop. |
| `host_test/` | Compiles the firmware on a PC with mock libraries: 15 checks for stage 1, 27 for the full system. |

## 1. Arduino IDE setup
1. Boards Manager: install **Arduino UNO R4 Boards**. Select *Arduino UNO R4 WiFi*.
2. Library Manager: install
   - **ArduinoMqttClient** (Arduino) — always
   - **ArduinoJson** 7.x (Benoit Blanchon) — always
   - **SparkFun MAX3010x Pulse and Proximity Sensor Library** — when `HAS_PPG 1`
   - **TinyGPSPlus** (Mikal Hart) — when `HAS_GPS 1`
   (WiFiS3, Arduino_LED_Matrix and Wire come with the board package.)
3. Tools > Firmware Updater: update the Wi-Fi module firmware if the serial log asks.

## 2. Configure
- `arduino_secrets.h`: Wi-Fi name/password, MQTT user/password (user = DEVICE_ID).
- `config.h`: `HAS_*` flags for the parts you have, `DEVICE_ID` (STA-01, STA-02 ...), `MQTT_HOST` (test broker now, ops laptop IP later).
- Wearer must **stand upright for 1 s after power-on** (IMU reference). Re-do anytime with `{"cmd":"calibrate"}`.

## 3. Ops-room broker (laptop)
```
mosquitto_passwd -c ops_room/passwd ops
mosquitto_passwd    ops_room/passwd STA-01
mosquitto -c ops_room/mosquitto.conf -v
```
Watch everything:
```
mosquitto_sub -h <laptop-ip> -u ops -P <pass> -t 'sta/v1/#' -v
```
Send commands:
```
mosquitto_pub -h <laptop-ip> -u ops -P <pass> -t sta/v1/STA-01/cmd -m '{"cmd":"ack","type":"FALL"}'
mosquitto_pub ... -m '{"cmd":"evac"}'
mosquitto_pub ... -m '{"cmd":"interval","sec":5}'
mosquitto_pub ... -m '{"cmd":"silent","on":true}'
mosquitto_pub ... -m '{"cmd":"reset_dose"}'
```

## 4. Topics
| Topic | Direction | QoS | Content |
|---|---|---|---|
| `sta/v1/<id>/telemetry` | vest → ops | 0 | every 2 s: vitals, IMU, GPS, radiation, battery, RSSI, active-alert bitmask |
| `sta/v1/<id>/alert` | vest → ops | 1 | events and condition changes (`pending`, `event`, `active`, `cleared`, `cancelled`) |
| `sta/v1/<id>/status` | vest → ops | 1, retained | online + sensors found; LWT sets `online:false` |
| `sta/v1/<id>/resp` | vest → ops | 1 | answer to each command |
| `sta/v1/<id>/cmd` | ops → vest | 1 | ping, ack, evac, stop, interval, silent, calibrate, reset_dose, status |

`alerts` bitmask bit order: SOS, FALL, IMPACT, MAN_DOWN, NO_MOTION, HR_HIGH, HR_LOW, SPO2_LOW,
SKIN_TEMP_HIGH, SKIN_TEMP_LOW, RAD_RATE, RAD_DOSE, SENSOR_OFF, BATTERY_LOW, GPS_LOST, VEST_TEMP_HIGH (bit 0 = SOS).

## 5. Wearer controls
- **Hold button 2 s** → SOS (critical).
- **Short press during the blinking "!"** (10 s after a fall) → "I'm OK", alarm cancelled.
- **Short press otherwise** → stop the current vibration.
- Two short buzzes + "OK" on the matrix → ops room acknowledged your alert.

## 6. Limits
Indicator-grade prototype: PPG on the torso is affected by motion, skin temperature is not core
temperature, the Geiger factor (0.00812 µSv/h per CPM for J305) needs calibration with a known
source, and the MPU-6050 saturates at 16 g. Thresholds in `config.h` are starting values.
