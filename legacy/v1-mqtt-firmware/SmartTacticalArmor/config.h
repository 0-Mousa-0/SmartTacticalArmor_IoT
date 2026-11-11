#pragma once
// =====================================================================
//  Smart Tactical Armor — configuration
//  Edit this file (and arduino_secrets.h) before flashing each vest.
// =====================================================================

// ---------------- Identity ----------------
// Must be unique per vest. Use the same value as the MQTT username so the
// broker ACL (pattern sta/v1/%u/...) lets each vest write only its own topics.
#define DEVICE_ID              "STA-01"
#define FW_VERSION             "1.1.0"

// ---------------- Hardware present (set to 1 as each part is added) ----------------
// Stage 1 (now): UNO R4 WiFi + IMU only. Parts set to 0 are skipped: no fake readings, no false alerts.
#ifndef HAS_PPG
  #define HAS_PPG              0                // MAX30102 heart rate + SpO2
#endif
#ifndef HAS_SKIN_TEMP
  #define HAS_SKIN_TEMP        0                // MAX30205 skin temperature
#endif
#ifndef HAS_GPS
  #define HAS_GPS              0                // NEO-6M / NEO-M8N on Serial1
#endif
#ifndef HAS_GEIGER
  #define HAS_GEIGER           0                // keep 0 until wired: a floating D2 counts noise as radiation
#endif
#ifndef HAS_BATTERY
  #define HAS_BATTERY          0                // battery divider on A0 (0 when powered from USB)
#endif
// The IMU is always used. The SOS button on D4 is optional (a jumper wire D4 -> GND works for tests).

// How the IMU is wired:
//   0 = jumper wires to the SDA/SCL (A4/A5) header pins -> Wire  (5 V header)
//   1 = Qwiic cable to the Qwiic connector             -> Wire1 (3.3 V)
#ifndef IMU_ON_QWIIC
  #define IMU_ON_QWIIC         0
#endif

// ---------------- MQTT broker ----------------
// Stage 1 quick test: public test broker (anyone can read it; test data only, no passwords).
// Later: your ops-room laptop running Mosquitto, e.g. "192.168.1.10".
#define MQTT_HOST              "test.mosquitto.org"
#define MQTT_USE_TLS           0                // 0 = lab (TCP 1883), 1 = field (TLS 8883)
#if MQTT_USE_TLS
  #define MQTT_PORT            8883
#else
  #define MQTT_PORT            1883
#endif
#define MQTT_TOPIC_ROOT        "sta/v1"         // topics: sta/v1/<DEVICE_ID>/<telemetry|alert|status|resp|cmd>
#define MQTT_KEEPALIVE_MS      15000UL          // broker marks the vest offline (LWT) after ~1.5x this
#define MQTT_CONNECT_TIMEOUT_MS 5000UL

// ---------------- Pins (UNO R4 WiFi) ----------------
#if IMU_ON_QWIIC
  #define SENSOR_WIRE          Wire1            // Qwiic connector (3.3 V)
#else
  #define SENSOR_WIRE          Wire             // SDA/SCL = A4/A5 header (5 V)
#endif
#define PIN_GEIGER             2                // Geiger module pulse output (VIN pin on RadiationD v1.1)
#define PIN_SOS_BUTTON         4                // push button to GND (internal pull-up)
#define PIN_VIBRATION          5                // PWM -> logic-level MOSFET gate -> coin vibration motor
#define PIN_BUZZER             6                // active buzzer through a transistor (GPIO max 8 mA)
#define PIN_BATTERY            A0               // battery divider midpoint
// GPS uses Serial1: D0 = RX1 (from GPS TX), D1 = TX1 (to GPS RX), through a level shifter.

// ---------------- I2C addresses ----------------
#define MAX30205_ADDR          0x48             // skin temperature (A0..A2 to GND)
#define MPU6050_ADDR           0x68             // IMU (AD0 to GND); 0x69 if AD0 high
// MAX30102 is fixed at 0x57 (handled by the SparkFun library)

// ---------------- Sensor settings ----------------
#define I2C_CLOCK_HZ           400000UL
#define GPS_BAUD               9600
#define GEIGER_USVH_PER_CPM    0.00812f         // common factor for the J305 tube; calibrate with a known source
#define PPG_LED_BRIGHTNESS     60               // 0..255 (~0.2 mA per step)
#define CONTACT_IR_MIN         50000UL          // IR level below this = sensor not on skin (tune on the vest)

// ---------------- Battery (2S Li-ion, divider 100k / 47k) ----------------
#define BAT_DIVIDER_RATIO      ((100.0f + 47.0f) / 47.0f)
#define BAT_V_EMPTY            6.4f
#define BAT_V_FULL             8.4f
#define BAT_V_PRESENT_MIN      3.0f             // below this we assume USB power, no pack
#define ADC_REF_V              5.0f
#define ADC_RESOLUTION_BITS    14

// ---------------- Outputs ----------------
#define VIBRATION_USE_PWM      1                // 0 = plain on/off (use if PWM clashes with another timer)
#define VIBRATION_PWM          170              // ~3.3 V average from 5 V for a 3 V coin motor
#define BUZZER_ENABLED_DEFAULT 1                // ops room can mute with {"cmd":"silent","on":true}

// ---------------- Task timing ----------------
#define TELEMETRY_PERIOD_MS    2000UL           // changeable at run time: {"cmd":"interval","sec":5}
#define IMU_PERIOD_MS          10UL             // 100 Hz
#define TEMP_PERIOD_MS         1000UL
#define BATTERY_PERIOD_MS      10000UL
#define RULES_PERIOD_MS        1000UL
#define COMMS_PERIOD_MS        50UL             // MQTT poll 20 Hz (each Wi-Fi call is a UART round trip)
#define WIFI_CHECK_MS          1000UL
#define UI_PERIOD_MS           250UL
#define GEIGER_BUCKET_MS       5000UL           // dose-rate window = buckets x 5 s = 60 s
#define GEIGER_BUCKETS         12
#define WIFI_RETRY_MS          10000UL
#define MQTT_RETRY_MS          5000UL
#define ALERT_REPEAT_MS        30000UL          // re-send an active alert this often
#define ALERT_QUEUE_LEN        12               // alerts kept while offline (store-and-forward)
#define ALERT_JSON_MAX         320

// ---------------- Alert thresholds (starting values — tune with test data) ----------------
#define HR_HIGH_WARN           160
#define HR_HIGH_CRIT           190
#define HR_LOW_WARN            45
#define HR_LOW_CRIT            35
#define SPO2_WARN              92
#define SPO2_CRIT              88
#define SKIN_T_HIGH_WARN       38.0f
#define SKIN_T_HIGH_CRIT       39.0f
#define SKIN_T_LOW_WARN        30.0f
#define VITAL_PERSIST_MS       10000UL          // a vital must stay out of range this long

#define RAD_WARN_USVH          1.0f
#define RAD_CRIT_USVH          10.0f
#define RAD_DOSE_WARN_USV      100.0f           // accumulated dose budget for one mission

#define FF_THRESH_G            0.45f            // free fall: |a| below this ...
#define FF_MIN_MS              60UL             // ... for at least this long
#define FALL_IMPACT_G          2.5f             // impact that must follow the free fall
#define FALL_WINDOW_MS         1000UL
#define IMPACT_G               6.0f             // hard hit / blast with or without a fall (sensor max 16 g)
#define POST_IMPACT_CHECK_MS   2500UL           // check posture this long after the impact
#define LYING_TILT_DEG         55.0f            // torso tilt from the calibrated upright pose
#define BENT_TILT_DEG          35.0f
#define PREALERT_MS            10000UL          // wearer can cancel a fall alarm with a short press
#define STILL_ACTIVITY_G       0.05f
#define STILL_GYRO_DPS         20.0f
#define INACTIVITY_MS          60000UL          // a board lying still on a desk will trigger this: expected
#define SOS_HOLD_MS            2000UL
#define CONTACT_LOST_MS        10000UL
#define BAT_LOW_PCT            20
#define GPS_LOST_MS            60000UL

// Vest temperature from the IMU chip: reads a few °C above the air around it (self-heating),
// so treat it as a heat-environment indicator, not body temperature.
#define VEST_T_WARN            45.0f
#define VEST_T_CRIT            55.0f
#define VEST_T_PERSIST_MS      5000UL
