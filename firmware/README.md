# Vest firmware — Arduino UNO R4 WiFi + MPU-6050 + MAX30102

The firmware turns the UNO R4 WiFi, an MPU-6050 and (optionally) a MAX30102 into a connected vest. It
detects falls, hard impacts, "man down", posture, inactivity and heat exposure, measures **heart rate
and blood oxygen (SpO2)**, then reports to the operations room over **MQTT with TLS** (EMQX Cloud). The
broker and topics are in [`../docs/05-mqtt-protocol.md`](../docs/05-mqtt-protocol.md).

| Item | Value |
|---|---|
| Board | Arduino UNO R4 WiFi (Renesas RA4M1 + ESP32-S3 Wi-Fi) |
| Sensors | MPU-6050 / GY-521 (accelerometer, gyroscope, **die temperature**); MAX30102 (heart rate, SpO2), optional |
| Size | 106 KB flash (40 %), 12.1 KB RAM (36 %) — room for the Phase 2–4 sensors |
| Verified | Compiles with `arduino-cli` for `arduino:renesas_uno:unor4wifi` (core 1.6.0) with no warnings; 65 host unit checks pass |

## 1. Wiring

| MPU-6050 (GY-521) | UNO R4 WiFi |
|---|---|
| VCC | 5V |
| GND | GND |
| SDA | SDA (A4) |
| SCL | SCL (A5) |
| XDA, XCL, AD0, INT | not connected |

| MAX30102 (heart rate + SpO2) | UNO R4 WiFi |
|---|---|
| VIN | 3.3V |
| GND | GND |
| SDA | SDA (the pin next to AREF, or A4: the same bus as the MPU-6050) |
| SCL | SCL (next to SDA, or A5) |
| INT, IRD, RD | not connected |

The MAX30102 is found automatically at power-on (address `0x57`). Without it, the vest works as before and
sends no vitals. Some MAX30102 boards pull SDA/SCL up to 1.8 V. If the boot log does not list `0x57`, or the
MPU-6050 (`0x68`) disappears once the MAX30102 is connected, plug the MAX30102 into the **Qwiic** connector
instead (3.3 V bus) and set `PPG_ON_QWIIC 1` in `config.h`.

Rest a **fingertip** gently on the sensor window (do not press hard) and keep still. Heart rate appears
after about 10 seconds, SpO2 shortly after.

Optional **SOS / "I'm OK" button**: a push button (or a jumper wire) from **D4** to **GND**.

* Hold 2 s: SOS (critical).
* Short press during the blinking "!": "I'm OK", which cancels a suspected fall.
* Short press at any other time: silence.

Using a Qwiic cable instead of jumper wires? Set `IMU_ON_QWIIC 1` in `config.h`.

## 2. Arduino IDE setup

1. **Boards Manager** → install **Arduino UNO R4 Boards** → select *Arduino UNO R4 WiFi*.
2. **Library Manager** → install **ArduinoMqttClient** (by Arduino) and **ArduinoJson** 7.x (by Benoit Blanchon).
   `WiFiS3`, `Wire` and `Arduino_LED_Matrix` come with the board package.
3. **Tools → Firmware Updater**: update the Wi-Fi module if the Serial Monitor suggests it. TLS works best on recent module firmware.

## 3. Configure

1. Copy `SmartTacticalArmor/arduino_secrets.example.h` to `SmartTacticalArmor/arduino_secrets.h`.
   That file is git-ignored, so never commit it.
   - `SECRET_SSID` / `SECRET_PASS`: your Wi-Fi network. The R4 joins **2.4 GHz** networks only.
   - `SECRET_MQTT_USER` / `SECRET_MQTT_PASS`: the vest's EMQX credentials (username = `DEVICE_ID`).
2. In `SmartTacticalArmor/config.h`:
   - `DEVICE_ID`: `STA-01`. It must match the vest registered on the dashboard's **Fleet** page.
   - `MQTT_HOST`: your EMQX deployment address. See [`../docs/07-setup-emqx.md`](../docs/07-setup-emqx.md).

If `arduino_secrets.h` is missing, the sketch still compiles with the template's placeholders and shows a
compiler warning. It will not connect until you fill in real values.

## 4. Upload and check

Open `SmartTacticalArmor/SmartTacticalArmor.ino`, upload it, and open the Serial Monitor at **115200**. You should see:

```
=== Smart Tactical Armor 2.1.0 / STA-01 ===
[I2C] devices: 0x57 0x68
[IMU] MPU-6050 OK — hold the vest upright and still for 1 s...
[PPG] MAX30102 OK — place a fingertip on the sensor
[NET] Wi-Fi module firmware 0.6.0
[SYS] Ready
[NET] Connecting to Wi-Fi <ssid>
[NET] Wi-Fi OK, IP 192.168.1.23
[MQTT] Connecting to <deployment>.emqxsl.com:8883
[MQTT] Connected
[PPG] finger on the sensor (IR 131072) — hold still, heart rate in ~10 s
[TX] {"id":"STA-01","seq":1,"up":9,"ts":1794...,"vest_t":33.4,"imu":{"peak_g":1.02,"tilt":3,...},"vit":{"contact":true,"hr":74,"spo2":97},"rssi":-58,"alerts":0,"pre":false}
```

| Serial Monitor shows | Meaning | What to do |
|---|---|---|
| `[I2C] devices: none` | Nothing answers on SDA/SCL | Check the wiring and that every module is powered |
| `[IMU] NOT FOUND` and no `0x68` | The MPU-6050 is not seen | Re-seat its wires. `0x69` instead means AD0 is high: set `MPU6050_ADDR 0x69` |
| `[PPG] MAX30102 not found` | No `0x57` on the bus | Optional sensor; see the note on 1.8 V boards above |
| `[PPG] no finger (IR …)` while a finger is on it | The IR level is below `PPG_CONTACT_IR_MIN` | Cover the whole window; raise `PPG_LED_CURRENT` a little |
| No `"imu"` / `"vest_t"` in the `[TX]` lines | The IMU was not found at power-on | Fix the wiring, then press RESET (sensors are detected once, at start-up) |

**At power-on, hold the IMU upright and still for 1 second**, in the orientation it will have on the vest.
That pose becomes "upright". You can redo it any time from the dashboard (**Calibrate posture**).

| LED matrix | Meaning |
|---|---|
| ✓ | connected, all good |
| Wi-Fi with a cross | no Wi-Fi / broker |
| "!" blinking | pre-alert (press the button if you are OK) or a critical alert |
| "!" steady | warning |
| "SOS" / "OK" | SOS sent / the operations room acknowledged |

## 5. Demo moves

| Do this | What the dashboard shows |
|---|---|
| Drop the IMU onto a cushion and leave it lying | FALL **pending**; after 10 s with no answer it becomes **critical** |
| Same, then tap D4 to GND within 10 s | FALL **cancelled by the wearer** |
| Sharp knock on the IMU (> 6 g) | **IMPACT** warning (+ MAN DOWN if it stays lying) |
| Hold D4 to GND for 2 s | **SOS** critical, top of the priority queue |
| Hair dryer on the IMU | **High vest temperature** (45 °C warning, 55 °C critical). Before that, the AI may already flag a *temperature anomaly* |
| Fingertip on the MAX30102, keep still | **Heart rate** and **blood oxygen** on the overview and the unit page, with a 15-minute trend |
| Lift the finger | "Place a finger on the sensor" instead of values (no alarm: nothing is measured) |
| Exercise, then measure again | Heart rate rises; the AI learns the wearer's usual pulse and flags unusual values |
| Leave it untouched for 60 s | **No motion** warning (critical if lying) |
| **Acknowledge** on the dashboard | "OK" on the LED matrix: help is coming |
| **Report interval → 2 s** | Faster live updates for a presentation |

The vest temperature is the **IMU chip's own temperature** and reads a few °C above the air. Present it as
vest or environment temperature, not body temperature. Body temperature comes in Phase 2 (MAX30205).

## 6. Code structure

```
SmartTacticalArmor/
├── SmartTacticalArmor.ino     composition root + cooperative scheduler (no delay() in loop)
├── config.h                   identity, broker, pins, thresholds, timing
├── arduino_secrets.example.h  template for Wi-Fi / MQTT credentials
└── src/
    ├── core/AlertTypes.h      alert vocabulary (bit order shared with the backend)
    ├── motion/                MotionAnalyzer (tilt, activity, stillness), FallDetector (state machine)   [pure C++]
    ├── alerts/                AlertManager (events, conditions, pre-alert), AlertOutbox (store-and-forward) [pure C++]
    ├── input/SosButton.h      debounce, short / long press                                                 [pure C++]
    ├── sensors/Mpu6050        I2C register driver (+ MPU-6500/9250 clones)
    ├── sensors/Max30102       I2C register driver: SpO2 mode, 50 samples/s through the chip's FIFO
    ├── vitals/PulseOximeter   heart rate (beat detection) + SpO2 (ratio of ratios)                     [pure C++]
    ├── net/MqttLink           Wi-Fi + MQTT/TLS, Last Will, command inbox, NTP time
    ├── app/                   Payloads (JSON contract), CommandParser
    └── ui/                    StatusDisplay (LED matrix), Haptics (optional buzzer / vibration)
```

Modules marked *pure C++* do not include `Arduino.h`. They are unit-tested on a PC:

```sh
cd firmware/test && ./run_tests.sh        # Linux / macOS / Git Bash  (g++, clang++ or zig)
.\firmware\test\run_tests.ps1             # Windows PowerShell
```

## 7. Heart rate and SpO2 (MAX30102)

* **Sampling.** The chip samples red and infrared light 200 times a second and averages 4, so 50 samples a
  second wait in its 32-sample FIFO. The loop empties it every 40 ms. If the loop was blocked (a Wi-Fi
  reconnect), the lost samples are skipped, so no false beat interval is measured.
* **Heart rate.** The slow light level and breathing drift are removed and the pulse is smoothed. Each beat
  is a peak above an adaptive threshold, 0.27–2 s after the previous one (30–222 bpm). The heart rate is the
  average of the recent beat intervals that agree with their median.
* **SpO2.** The pulse size of the red and the infrared light, each divided by its light level, gives the
  "ratio of ratios" R. Maxim's reference curve turns R into SpO2: `-45.060 R² + 30.354 R + 94.845`.
* **Alarms on the vest.** `HR_HIGH` (160 warning, 190 critical), `HR_LOW` (45 / 35) and `SPO2_LOW`
  (92 % / 88 %) must last 10 s before they are raised. Change them in `config.h`. `SENSOR_OFF` (the sensor
  lost skin contact) is off by default for a fingertip sensor; set `PPG_SENSOR_OFF_ALERT 1` once the sensor
  is fixed against the skin inside the vest.
* **Tests.** `firmware/test` feeds synthetic pulse waves (45, 72, 84 and 120 bpm, two oxygen levels, noise,
  breathing drift, lost samples) through the algorithm on a PC.

## 8. Adding the next sensors

The protocol and the backend already accept the full sensor set (`vit`, `gps`, `rad`, `bat` sections; alert
types `SKIN_TEMP_HIGH`, `RAD_RATE`, …). The dashboard shows those tiles as "Not fitted · Phase N" until
data arrives. To add a sensor:

1. Port its driver from `../legacy/v1-mqtt-firmware` into a new module under `src/sensors/`.
2. Add its fields to `TelemetrySnapshot` / `buildTelemetry`.
3. Set its flag in `buildStatus`.
4. Add its rules in `rulesTask()`.

## 9. Known limitations

* `WiFi.begin()` and the TLS handshake are blocking calls in the UNO R4 WiFi libraries. Motion sampling pauses
  for a few seconds while the vest *reconnects*, then resumes. Planned improvement: MPU-6050 FIFO buffering.
* Thresholds come from the earlier prototype. Tune them with real vest data.
* Heart rate and SpO2 need a still fingertip (or skin) on the sensor: movement and bright light disturb them.
  SpO2 uses Maxim's generic curve, not a calibration against a medical oximeter.
* This is an indicator-grade prototype, not a certified safety or medical device.
