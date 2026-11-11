#pragma once
// =====================================================================
//  Smart Tactical Armor — vest configuration (edit before flashing)
//  Secrets (Wi-Fi + MQTT passwords) live in arduino_secrets.h.
// =====================================================================

// ---------------- Identity ----------------
// Unique per vest. Must equal: the device code registered in the dashboard
// (Fleet page) AND the vest's MQTT username in EMQX.
#define DEVICE_ID               "STA-01"
#define FW_VERSION              "2.0.0"

// ---------------- Broker (EMQX Cloud Serverless) ----------------
// EMQX console -> your deployment -> Overview -> "Address" (MQTT over TLS).
#define MQTT_HOST               "your-deployment.ala.eu-central-1.emqxsl.com"
#define MQTT_PORT               8883          // EMQX Serverless accepts TLS only (8883)
#define MQTT_USE_TLS            1
#define MQTT_TOPIC_ROOT         "sta/v1"      // topics: sta/v1/<DEVICE_ID>/<telemetry|alert|status|resp|cmd>
#define MQTT_KEEPALIVE_MS       30000UL
#define MQTT_CONNECT_TIMEOUT_MS 8000UL
#define WIFI_RETRY_MS           10000UL
#define MQTT_RETRY_MS           5000UL

// ---------------- Wiring (UNO R4 WiFi) ----------------
// MPU-6050 (GY-521): VCC->5V, GND->GND, SDA->SDA(A4), SCL->SCL(A5).
// Qwiic cable instead? set IMU_ON_QWIIC 1 (Wire1, 3.3 V).
#define IMU_ON_QWIIC            0
#define MPU6050_ADDR            0x68          // 0x69 if AD0 is tied high
#define I2C_CLOCK_HZ            400000UL
#define PIN_SOS_BUTTON          4             // button (or jumper wire) to GND
// Optional outputs — not part of Phase 1 hardware. Set to 1 when fitted.
#define HAS_VIBRATION           0
#define PIN_VIBRATION           5             // PWM -> logic-level MOSFET -> coin motor
#define VIBRATION_PWM           170
#define HAS_BUZZER              0
#define PIN_BUZZER              6             // active buzzer through a transistor

// ---------------- Timing ----------------
// 5 s keeps one vest well inside the EMQX free tier (1 GB/month). The ops
// room can switch a vest to 2 s for a live demo ("Report interval").
#define TELEMETRY_PERIOD_MS     5000UL
#define IMU_PERIOD_MS           10UL          // 100 Hz motion sampling
#define RULES_PERIOD_MS         1000UL
#define UI_PERIOD_MS            250UL
#define ALERT_REMINDER_MS       30000UL       // re-send an active condition this often
#define OUTBOX_CAPACITY         16            // alerts kept while offline (store-and-forward)
#define BUTTON_DEBOUNCE_MS      30UL

// ---------------- Fall / impact detection ----------------
#define FF_THRESH_G             0.45f         // free fall: |a| below this ...
#define FF_MIN_MS               60UL          // ... for at least this long
#define FALL_IMPACT_G           2.5f          // impact that must follow the free fall
#define FALL_WINDOW_MS          1000UL
#define IMPACT_G                6.0f          // hard hit / blast, with or without a fall (sensor max 16 g)
#define POST_IMPACT_CHECK_MS    2500UL        // check posture this long after the impact
#define LYING_TILT_DEG          55.0f         // torso tilt from the calibrated upright pose
#define BENT_TILT_DEG           35.0f
#define PREALERT_MS             10000UL       // wearer can cancel with a short press
#define SOS_HOLD_MS             2000UL

// ---------------- Inactivity ----------------
#define STILL_ACTIVITY_G        0.05f
#define STILL_GYRO_DPS          20.0f
#define INACTIVITY_MS           60000UL       // a board lying on a desk WILL trigger this (expected)

// ---------------- Vest temperature (MPU-6050 die sensor) ----------------
// Reads a few °C above the surrounding air (self-heating): an environment /
// heat-exposure indicator, NOT body temperature (that is Phase 2, MAX30205).
#define VEST_T_WARN             45.0f
#define VEST_T_CRIT             55.0f
#define VEST_T_PERSIST_MS       5000UL
