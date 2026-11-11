/*
 * =====================================================================
 *  SMART TACTICAL ARMOR — IoT firmware (MVP)
 *  Board : Arduino UNO R4 WiFi (Renesas RA4M1 + ESP32-S3 Wi-Fi)
 * =====================================================================
 *  Sensors (inputs)
 *    - MAX30102  heart rate + SpO2 ........ I2C (Qwiic / Wire1) 0x57
 *    - MAX30205  skin temperature ......... I2C (Qwiic / Wire1) 0x48
 *    - MPU-6050  IMU: fall / impact / posture  I2C (Qwiic / Wire1) 0x68
 *    - GPS NEO-6M / NEO-M8N ............... UART Serial1 (D0/D1), NMEA 0183
 *    - Geiger counter (J305 / M4011) ...... pulse -> D2 interrupt
 *    - SOS / cancel push button ........... D4 (INPUT_PULLUP)
 *    - Battery voltage .................... A0 (divider)
 *    - Commands from the ops room ......... MQTT  sta/v1/<id>/cmd
 *  Outputs
 *    - Vibration motor (silent alerts) .... D5 PWM -> MOSFET
 *    - Buzzer ............................. D6 -> transistor
 *    - 12x8 LED matrix (on-board) ......... status icons
 *    - MQTT: telemetry (QoS 0, every 2 s), alerts (QoS 1), status (retained + LWT), resp
 *
 *  Libraries (Arduino IDE > Library Manager):
 *    always : ArduinoMqttClient (Arduino), ArduinoJson 7.x (Benoit Blanchon)
 *    HAS_PPG: SparkFun MAX3010x Pulse and Proximity Sensor Library
 *    HAS_GPS: TinyGPSPlus (Mikal Hart)
 *  Bundled with the "Arduino UNO R4 Boards" core: WiFiS3, Arduino_LED_Matrix, Wire
 *
 *  Staged build: set HAS_* in config.h to match the parts you have. Stage 1 = board + IMU only
 *  (fall / impact / posture / no-motion + vest temperature from the IMU chip + SOS on D4).
 *
 *  NOTE: indicator-grade prototype. Not a certified medical or dosimetry device.
 * =====================================================================
 */

#include "config.h"
#include "arduino_secrets.h"
#include "matrix_frames.h"

#include <Wire.h>
#include <math.h>
#include <string.h>
#include <WiFiS3.h>
#include <ArduinoMqttClient.h>
#include <ArduinoJson.h>
#include "Arduino_LED_Matrix.h"
#if HAS_GPS
#include <TinyGPS++.h>
#endif
#if HAS_PPG
#include "MAX30105.h"
#include "spo2_algorithm.h"
#endif

// =====================================================================
//  Types
// =====================================================================

enum AlertType : uint8_t {
  AL_SOS = 0, AL_FALL, AL_IMPACT, AL_MAN_DOWN, AL_NO_MOTION,
  AL_HR_HIGH, AL_HR_LOW, AL_SPO2_LOW, AL_SKIN_T_HIGH, AL_SKIN_T_LOW,
  AL_RAD_RATE, AL_RAD_DOSE, AL_SENSOR_OFF, AL_BATTERY_LOW, AL_GPS_LOST,
  AL_VEST_TEMP_HIGH,
  AL_COUNT
};

const char* const ALERT_NAMES[AL_COUNT] = {
  "SOS", "FALL", "IMPACT", "MAN_DOWN", "NO_MOTION",
  "HR_HIGH", "HR_LOW", "SPO2_LOW", "SKIN_TEMP_HIGH", "SKIN_TEMP_LOW",
  "RAD_RATE", "RAD_DOSE", "SENSOR_OFF", "BATTERY_LOW", "GPS_LOST",
  "VEST_TEMP_HIGH"
};

enum Severity : uint8_t { SEV_NONE = 0, SEV_INFO = 1, SEV_WARNING = 2, SEV_CRITICAL = 3 };

enum NetState : uint8_t { NET_NO_WIFI = 0, NET_NO_MQTT, NET_OK };

enum FallPhase : uint8_t { FP_IDLE = 0, FP_FREEFALL, FP_POST_IMPACT, FP_PREALERT };

enum HapticPrio : uint8_t { HP_NONE = 0, HP_INFO, HP_WARN, HP_CRIT, HP_URGENT };

struct ConditionAlert {          // alerts that are "active" while a condition holds
  bool     active;
  uint8_t  sev;
  uint32_t since;                // when the condition became true (0 = not true)
  uint32_t lastSent;
};

struct Vitals {
  float    hr;                   // bpm (smoothed)
  float    spo2;                 // %
  bool     hrHave, spo2Have;
  uint32_t hrTime, spo2Time;     // last good reading
  bool     hrValid, spo2Valid;
  bool     contact;              // PPG sensor touching skin
  uint32_t lastContact;
  float    skinT;
  bool     skinTValid;
};

struct Motion {
  float    ax, ay, az;           // g
  float    aMag;                 // |a| in g
  float    gyroMag;              // deg/s
  float    gLp[3];               // low-passed gravity vector
  float    ref[3];               // upright reference (calibrated)
  float    tiltDeg;
  float    activity;             // EMA of |a - gravity| (g)
  float    peakSinceTx;          // max |a| since last telemetry
  uint32_t lastActive;
  float    chipT;                // IMU die temperature (°C) = vest / ambient indicator, NOT body temp
  bool     chipTValid;
};

struct FallSM {
  FallPhase phase;
  uint32_t  t0;
  uint32_t  ffStart;
  bool      causeImpact;
  float     peak;
};

struct PreAlert {
  bool      active;
  AlertType type;
  uint32_t  start;
  float     val;
};

struct Radiation {
  uint32_t counts[GEIGER_BUCKETS];
  uint32_t spanMs[GEIGER_BUCKETS];
  uint8_t  idx, filled;
  uint32_t lastBucket;
  float    cpm, usvh, doseUsv;
};

struct Battery {
  float   v;
  uint8_t pct;
  bool    present;
};

struct Button {
  bool     stable, lastRead;
  uint32_t lastChange, pressStart;
  bool     longFired, shortEvent;
};

struct Haptic {
  const uint16_t* steps;         // on, off, on, off ... (ms)
  uint8_t  len, idx;
  int16_t  repeatsLeft;          // -1 = until stopped
  uint32_t stepStart;
  bool     withBuzzer;
  uint8_t  prio;
  bool     outOn;
};

// =====================================================================
//  Globals
// =====================================================================

#if MQTT_USE_TLS
WiFiSSLClient netClient;
#else
WiFiClient netClient;
#endif
MqttClient       mqtt(netClient);
ArduinoLEDMatrix matrix;
#if HAS_GPS
TinyGPSPlus      gps;
#endif
#if HAS_PPG
MAX30105         ppg;
static_assert(BUFFER_SIZE == 100, "spo2_algorithm expects a 100-sample window (25 sps x 4 s)");
const uint8_t PPG_WIN  = 100;    // 4 s at 25 samples/s
const uint8_t PPG_STEP = 25;     // recompute every 1 s
uint32_t irBuf[PPG_WIN];
uint32_t redBuf[PPG_WIN];
uint8_t  ppgCount = 0;
uint32_t lastPpgSample = 0;
#endif

uint8_t     imuWho  = 0;         // WHO_AM_I register
bool        imu6500 = false;     // MPU-6500 / 9250 family (different temperature formula)
const char* imuChip = "none";

bool ppgOk = false, tempOk = false, imuOk = false;

Vitals         vit;
Motion         mo;
FallSM         fsm;
PreAlert       pre;
Radiation      rad;
Battery        bat;
Button         btn;
Haptic         hap;
ConditionAlert cond[AL_COUNT];

volatile uint32_t geigerPulses = 0;

NetState netState = NET_NO_WIFI;
bool     wifiUp = false;
uint32_t lastWifiCheck = 0;
bool     wifiTried = false, mqttTried = false;
uint32_t lastWifiAttempt = 0, lastMqttAttempt = 0;
bool     gpsEverFix = false;
uint32_t gpsLastFix = 0;

char topicTelemetry[64], topicAlert[64], topicStatus[64], topicResp[64], topicCmd[64];

char     alertQueue[ALERT_QUEUE_LEN][ALERT_JSON_MAX];
uint16_t alertQueueLen[ALERT_QUEUE_LEN];
uint8_t  aqHead = 0, aqCount = 0;

char           cmdBuf[256];
size_t         cmdLen = 0;
volatile bool  cmdPending = false;

uint32_t telemetryPeriodMs = TELEMETRY_PERIOD_MS;
uint32_t telemetrySeq = 0, alertSeq = 0;
bool     buzzerEnabled = BUZZER_ENABLED_DEFAULT;
bool     recalibrateRequested = false;

const uint32_t* overlayFrame = nullptr;
uint32_t        overlayUntil = 0;
const uint32_t* shownFrame   = nullptr;
bool            blinkPhase   = false;

uint32_t tImu = 0, tTemp = 0, tBat = 0, tRules = 0, tTelemetry = 0, tUi = 0, tComms = 0;

// Haptic patterns (ms): on, off, on, off ...
const uint16_t PAT_ACK[]      = {120, 120, 120, 500};          // ops room acknowledged
const uint16_t PAT_WARN[]     = {200, 150, 200, 150, 200, 700};
const uint16_t PAT_CRIT[]     = {600, 200, 600, 200, 600, 900};
const uint16_t PAT_PREALERT[] = {300, 300};                    // repeats until cancel / timeout
const uint16_t PAT_EVAC[]     = {1000, 300};
const uint16_t PAT_CONFIRM[]  = {800, 200};                    // SOS sent / cancelled
#define PAT_LEN(p) ((uint8_t)(sizeof(p) / sizeof((p)[0])))

// =====================================================================
//  Prototypes
// =====================================================================
void ppgInit();
void ppgTask();
void computeVitals();
bool max30205Read(float &t);
void tempTask();
bool mpuWrite(uint8_t reg, uint8_t val);
uint8_t mpuReadReg(uint8_t reg);
void i2cScan();
bool mpuInit();
bool mpuRead();
void imuCalibrate();
void imuTask(uint32_t now);
void fallStateMachine(uint32_t now);
void startPrealert(AlertType t, float val);
void prealertTask(uint32_t now);
void gpsTask();
bool gpsHasFix();
uint32_t gpsEpoch();
void onGeigerPulse();
void geigerTask(uint32_t now);
void batteryTask();
void buttonTask(uint32_t now);
void triggerSOS();
void rulesTask(uint32_t now);
void updateCondition(AlertType t, bool on, uint8_t sev, float val, uint32_t persistMs);
void raiseAlert(AlertType t, uint8_t sev, const char* state, float val);
void enqueueAlert(const char* json, size_t len);
void flushAlertQueue();
void commsTask(uint32_t now);
bool mqttConnect();
bool mqttPublish(const char* topic, const char* payload, size_t len, bool retain, uint8_t qos);
void publishStatus(bool online);
void publishTelemetry();
void onMqttMessage(int messageSize);
void handleCommand();
void sendResp(const char* cmd, bool ok, const char* info);
void hapticPlay(const uint16_t* steps, uint8_t len, int16_t repeats, bool withBuzzer, uint8_t prio);
void hapticStop();
void hapticTask(uint32_t now);
void showOverlay(const uint32_t* frame, uint32_t ms);
void uiTask(uint32_t now);
uint32_t activeAlertMask();
uint8_t highestActiveSeverity();
double rnd(double v, int decimals);
uint32_t toEpoch(int y, int m, int d, int hh, int mi, int ss);

// =====================================================================
//  Setup
// =====================================================================
void setup() {
  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 1500) { }      // don't block on battery power

  Serial.println();
  Serial.println(F("=== Smart Tactical Armor " FW_VERSION " / " DEVICE_ID " ==="));

  pinMode(PIN_SOS_BUTTON, INPUT_PULLUP);
  pinMode(PIN_VIBRATION, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_VIBRATION, LOW);
  digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_GEIGER, INPUT);
  analogReadResolution(ADC_RESOLUTION_BITS);

  matrix.begin();
  matrix.loadFrame(FRAME_WIFI);
  shownFrame = FRAME_WIFI;

  memset(&vit, 0, sizeof(vit));
  memset(&mo, 0, sizeof(mo));
  memset(&fsm, 0, sizeof(fsm));
  memset(&pre, 0, sizeof(pre));
  memset(&rad, 0, sizeof(rad));
  memset(&bat, 0, sizeof(bat));
  memset(&btn, 0, sizeof(btn));
  memset(&hap, 0, sizeof(hap));
  memset(cond, 0, sizeof(cond));

  // ---- I2C sensors ----
  SENSOR_WIRE.begin();
  SENSOR_WIRE.setClock(I2C_CLOCK_HZ);
  i2cScan();                                   // prints every address found (IMU = 0x68)

  imuOk = mpuInit();
  if (imuOk) {
    Serial.print(F("[IMU] ")); Serial.print(imuChip);
    Serial.print(F(" OK (WHO_AM_I 0x")); Serial.print(imuWho, HEX); Serial.println(F(")"));
    Serial.println(F("[IMU] Calibrating upright pose: hold the vest/board upright and still for 1 s..."));
    imuCalibrate();
  } else {
    Serial.println(F("[IMU] NOT FOUND - check wiring and IMU_ON_QWIIC in config.h"));
  }

#if HAS_SKIN_TEMP
  float t;
  tempOk = max30205Read(t);
  Serial.println(tempOk ? F("[TEMP] MAX30205 OK") : F("[TEMP] MAX30205 NOT FOUND"));
#endif
#if HAS_PPG
  ppgInit();
  Serial.println(ppgOk ? F("[PPG] MAX30102 OK") : F("[PPG] MAX30102 NOT FOUND"));
#endif
#if HAS_GPS
  Serial1.begin(GPS_BAUD);
#endif
#if HAS_GEIGER
  attachInterrupt(digitalPinToInterrupt(PIN_GEIGER), onGeigerPulse, FALLING);
#endif
  rad.lastBucket = millis();

  // ---- Topics ----
  snprintf(topicTelemetry, sizeof(topicTelemetry), "%s/%s/telemetry", MQTT_TOPIC_ROOT, DEVICE_ID);
  snprintf(topicAlert,     sizeof(topicAlert),     "%s/%s/alert",     MQTT_TOPIC_ROOT, DEVICE_ID);
  snprintf(topicStatus,    sizeof(topicStatus),    "%s/%s/status",    MQTT_TOPIC_ROOT, DEVICE_ID);
  snprintf(topicResp,      sizeof(topicResp),      "%s/%s/resp",      MQTT_TOPIC_ROOT, DEVICE_ID);
  snprintf(topicCmd,       sizeof(topicCmd),       "%s/%s/cmd",       MQTT_TOPIC_ROOT, DEVICE_ID);

  // ---- Wi-Fi module check ----
  if (WiFi.status() == WL_NO_MODULE) {
    Serial.println(F("[NET] Wi-Fi module not responding!"));
  } else {
    String fv = WiFi.firmwareVersion();
    Serial.print(F("[NET] Wi-Fi firmware ")); Serial.println(fv);
    if (fv < WIFI_FIRMWARE_LATEST_VERSION) {
      Serial.println(F("[NET] Tip: update the Wi-Fi module firmware (IDE > Tools > Firmware Updater)"));
    }
  }

  mqtt.onMessage(onMqttMessage);

  batteryTask();
  uint32_t now = millis();
  tImu = tTemp = tBat = tRules = tTelemetry = tUi = tComms = now;
  Serial.println(F("[SYS] Ready"));
}

// =====================================================================
//  Main loop — cooperative scheduler (no delay() anywhere)
// =====================================================================
void loop() {
  uint32_t now = millis();

#if HAS_GPS
  gpsTask();                                   // drain NMEA bytes
#endif
#if HAS_PPG
  ppgTask();                                   // drain MAX30102 FIFO
#endif

  if (imuOk && now - tImu >= IMU_PERIOD_MS) {  // 100 Hz motion
    tImu += IMU_PERIOD_MS;
    if (now - tImu > 100) tImu = now;          // skip backlog after a blocking call
    imuTask(now);
  }

  buttonTask(now);
  prealertTask(now);
  hapticTask(now);

  if (now - tTemp >= TEMP_PERIOD_MS) { tTemp = now; tempTask(); }
#if HAS_GEIGER
  geigerTask(now);
#endif
  if (now - tBat >= BATTERY_PERIOD_MS) { tBat = now; batteryTask(); }
  if (now - tRules >= RULES_PERIOD_MS) { tRules = now; rulesTask(now); }

  if (now - tComms >= COMMS_PERIOD_MS) { tComms = now; commsTask(now); }
  if (cmdPending) { cmdPending = false; handleCommand(); }

  if (now - tTelemetry >= telemetryPeriodMs) { tTelemetry = now; publishTelemetry(); }

  if (now - tUi >= UI_PERIOD_MS) { tUi = now; uiTask(now); }

  btn.shortEvent = false;                      // a short press is consumed in one pass
}

// =====================================================================
//  Heart rate + SpO2 (MAX30102)
// =====================================================================
void ppgInit() {
#if HAS_PPG
  ppgOk = ppg.begin(SENSOR_WIRE, I2C_SPEED_FAST);
  if (!ppgOk) return;
  // brightness, sampleAverage=4, ledMode=2 (red+IR), sampleRate=100, pulseWidth=411, adcRange=4096
  // 100 Hz / average 4 = 25 samples/s, which is what the Maxim algorithm expects.
  ppg.setup(PPG_LED_BRIGHTNESS, 4, 2, 100, 411, 4096);
#endif
}

void ppgTask() {
#if HAS_PPG
  if (!ppgOk) return;
  ppg.check();
  while (ppg.available()) {
    uint32_t red = ppg.getFIFORed();
    uint32_t ir  = ppg.getFIFOIR();
    ppg.nextSample();

    uint32_t now = millis();
    if (now - lastPpgSample > 500) ppgCount = 0;     // gap (e.g. Wi-Fi reconnect): restart window
    lastPpgSample = now;

    if (ir >= CONTACT_IR_MIN) vit.lastContact = now;
    vit.contact = (vit.lastContact != 0) && (now - vit.lastContact < 1000);

    if (ppgCount >= PPG_WIN) {                         // slide the window by 1 s
      memmove(redBuf, redBuf + PPG_STEP, (PPG_WIN - PPG_STEP) * sizeof(uint32_t));
      memmove(irBuf,  irBuf  + PPG_STEP, (PPG_WIN - PPG_STEP) * sizeof(uint32_t));
      ppgCount = PPG_WIN - PPG_STEP;
    }
    redBuf[ppgCount] = red;
    irBuf[ppgCount]  = ir;
    ppgCount++;
    if (ppgCount == PPG_WIN) computeVitals();
  }
#endif
}

void computeVitals() {
#if HAS_PPG
  int32_t spo2 = 0, hr = 0;
  int8_t  spo2Ok = 0, hrOk = 0;
  maxim_heart_rate_and_oxygen_saturation(irBuf, PPG_WIN, redBuf, &spo2, &spo2Ok, &hr, &hrOk);

  uint32_t now = millis();
  if (vit.contact) {
    if (hrOk && hr >= 30 && hr <= 220) {               // reject impossible values, then smooth
      vit.hr = vit.hrHave ? (0.7f * vit.hr + 0.3f * (float)hr) : (float)hr;
      vit.hrHave = true; vit.hrTime = now;
    }
    if (spo2Ok && spo2 >= 70 && spo2 <= 100) {
      vit.spo2 = vit.spo2Have ? (0.7f * vit.spo2 + 0.3f * (float)spo2) : (float)spo2;
      vit.spo2Have = true; vit.spo2Time = now;
    }
  }
  vit.hrValid   = vit.contact && vit.hrHave   && (now - vit.hrTime   < 5000);
  vit.spo2Valid = vit.contact && vit.spo2Have && (now - vit.spo2Time < 5000);
#endif
}

// =====================================================================
//  Skin temperature (MAX30205, raw registers)
// =====================================================================
bool max30205Read(float &t) {
  SENSOR_WIRE.beginTransmission((uint8_t)MAX30205_ADDR);
  SENSOR_WIRE.write((uint8_t)0x00);                      // temperature register
  if (SENSOR_WIRE.endTransmission(false) != 0) return false;
  if (SENSOR_WIRE.requestFrom((uint8_t)MAX30205_ADDR, (uint8_t)2) != 2) return false;
  uint8_t msb = SENSOR_WIRE.read();
  uint8_t lsb = SENSOR_WIRE.read();
  int16_t raw = (int16_t)(((uint16_t)msb << 8) | lsb);
  t = raw * 0.00390625f;                                 // 1 LSB = 1/256 °C
  return true;
}

void tempTask() {
  if (!tempOk) { vit.skinTValid = false; return; }
  float t;
  if (max30205Read(t) && t > -20.0f && t < 60.0f) {
    vit.skinT = t;
    vit.skinTValid = true;
  } else {
    vit.skinTValid = false;
  }
}

// =====================================================================
//  IMU (MPU-6050, raw registers) + motion analytics
// =====================================================================
bool mpuWrite(uint8_t reg, uint8_t val) {
  SENSOR_WIRE.beginTransmission((uint8_t)MPU6050_ADDR);
  SENSOR_WIRE.write(reg);
  SENSOR_WIRE.write(val);
  return SENSOR_WIRE.endTransmission() == 0;
}

uint8_t mpuReadReg(uint8_t reg) {
  SENSOR_WIRE.beginTransmission((uint8_t)MPU6050_ADDR);
  SENSOR_WIRE.write(reg);
  if (SENSOR_WIRE.endTransmission(false) != 0) return 0xFF;
  if (SENSOR_WIRE.requestFrom((uint8_t)MPU6050_ADDR, (uint8_t)1) != 1) return 0xFF;
  return (uint8_t)SENSOR_WIRE.read();
}

void i2cScan() {
  Serial.print(IMU_ON_QWIIC ? F("[I2C] Qwiic bus (Wire1):") : F("[I2C] SDA/SCL pins (Wire):"));
  uint8_t found = 0;
  for (uint8_t a = 1; a < 127; a++) {
    SENSOR_WIRE.beginTransmission(a);
    if (SENSOR_WIRE.endTransmission() == 0) {
      Serial.print(F(" 0x"));
      if (a < 16) Serial.print('0');
      Serial.print(a, HEX);
      found++;
    }
  }
  if (!found) Serial.print(F(" no devices"));
  Serial.println();
}

bool mpuInit() {
  if (!mpuWrite(0x6B, 0x01)) return false;   // PWR_MGMT_1: wake, PLL clock
  delay(50);
  imuWho  = mpuReadReg(0x75);                // WHO_AM_I
  imu6500 = (imuWho == 0x70 || imuWho == 0x71 || imuWho == 0x73);
  imuChip = imuWho == 0x68 ? "MPU-6050" : imuWho == 0x70 ? "MPU-6500" :
            imuWho == 0x71 ? "MPU-9250" : imuWho == 0x73 ? "MPU-9255" : "MPU-compatible";
  mpuWrite(0x19, 0x04);                      // SMPLRT_DIV: 1 kHz / 5 = 200 Hz register update
  mpuWrite(0x1A, 0x01);                      // CONFIG: DLPF ~184 Hz (keeps short impact peaks)
  mpuWrite(0x1B, 0x18);                      // GYRO_CONFIG: ±2000 dps (16.4 LSB/dps)
  mpuWrite(0x1C, 0x18);                      // ACCEL_CONFIG: ±16 g (2048 LSB/g)
  delay(20);
  return mpuRead();
}

bool mpuRead() {
  SENSOR_WIRE.beginTransmission((uint8_t)MPU6050_ADDR);
  SENSOR_WIRE.write((uint8_t)0x3B);                      // ACCEL_XOUT_H
  if (SENSOR_WIRE.endTransmission(false) != 0) return false;
  if (SENSOR_WIRE.requestFrom((uint8_t)MPU6050_ADDR, (uint8_t)14) != 14) return false;
  uint8_t b[14];
  for (uint8_t i = 0; i < 14; i++) b[i] = SENSOR_WIRE.read();
  int16_t rax = (int16_t)(((uint16_t)b[0]  << 8) | b[1]);
  int16_t ray = (int16_t)(((uint16_t)b[2]  << 8) | b[3]);
  int16_t raz = (int16_t)(((uint16_t)b[4]  << 8) | b[5]);
  int16_t rgx = (int16_t)(((uint16_t)b[8]  << 8) | b[9]);
  int16_t rgy = (int16_t)(((uint16_t)b[10] << 8) | b[11]);
  int16_t rgz = (int16_t)(((uint16_t)b[12] << 8) | b[13]);
  int16_t rtc = (int16_t)(((uint16_t)b[6]  << 8) | b[7]);
  float tc = imu6500 ? (rtc / 333.87f + 21.0f) : (rtc / 340.0f + 36.53f);   // datasheet formulas
  mo.chipT = mo.chipTValid ? (0.98f * mo.chipT + 0.02f * tc) : tc;
  mo.chipTValid = true;
  mo.ax = rax / 2048.0f;
  mo.ay = ray / 2048.0f;
  mo.az = raz / 2048.0f;
  float gx = rgx / 16.4f, gy = rgy / 16.4f, gz = rgz / 16.4f;
  mo.aMag    = sqrtf(mo.ax * mo.ax + mo.ay * mo.ay + mo.az * mo.az);
  mo.gyroMag = sqrtf(gx * gx + gy * gy + gz * gz);
  return true;
}

// Average 1 s of samples as the "upright" reference. The wearer must be standing.
void imuCalibrate() {
  float sx = 0, sy = 0, sz = 0;
  uint8_t n = 0;
  for (uint8_t i = 0; i < 100; i++) {
    if (mpuRead()) { sx += mo.ax; sy += mo.ay; sz += mo.az; n++; }
    delay(10);
  }
  if (n == 0) return;
  mo.ref[0] = sx / n; mo.ref[1] = sy / n; mo.ref[2] = sz / n;
  for (uint8_t i = 0; i < 3; i++) mo.gLp[i] = mo.ref[i];
  mo.lastActive = millis();
}

void imuTask(uint32_t now) {
  if (!mpuRead()) return;

  // gravity estimate (low-pass, ~0.2 s)
  const float a = 0.05f;
  mo.gLp[0] += a * (mo.ax - mo.gLp[0]);
  mo.gLp[1] += a * (mo.ay - mo.gLp[1]);
  mo.gLp[2] += a * (mo.az - mo.gLp[2]);

  if (recalibrateRequested) {
    for (uint8_t i = 0; i < 3; i++) mo.ref[i] = mo.gLp[i];
    recalibrateRequested = false;
  }

  // tilt between current gravity and the upright reference
  float dot = mo.gLp[0] * mo.ref[0] + mo.gLp[1] * mo.ref[1] + mo.gLp[2] * mo.ref[2];
  float n1 = sqrtf(mo.gLp[0] * mo.gLp[0] + mo.gLp[1] * mo.gLp[1] + mo.gLp[2] * mo.gLp[2]);
  float n2 = sqrtf(mo.ref[0] * mo.ref[0] + mo.ref[1] * mo.ref[1] + mo.ref[2] * mo.ref[2]);
  if (n1 > 0.2f && n2 > 0.2f) {
    float c = dot / (n1 * n2);
    if (c > 1.0f) c = 1.0f;
    if (c < -1.0f) c = -1.0f;
    mo.tiltDeg = acosf(c) * 57.29578f;
  }

  // activity level (EMA ~1 s) of the dynamic acceleration (gravity removed)
  float dx = mo.ax - mo.gLp[0], dy = mo.ay - mo.gLp[1], dz = mo.az - mo.gLp[2];
  float dyn = sqrtf(dx * dx + dy * dy + dz * dz);
  mo.activity = 0.99f * mo.activity + 0.01f * dyn;
  if (mo.activity > STILL_ACTIVITY_G || mo.gyroMag > STILL_GYRO_DPS) mo.lastActive = now;

  if (mo.aMag > mo.peakSinceTx) mo.peakSinceTx = mo.aMag;

  fallStateMachine(now);
}

// free fall -> impact -> lying = fall;  hard impact -> lying = man down
void fallStateMachine(uint32_t now) {
  float a = mo.aMag;
  switch (fsm.phase) {
    case FP_IDLE:
      if (a >= IMPACT_G) {
        raiseAlert(AL_IMPACT, SEV_WARNING, "event", a);
        fsm.causeImpact = true; fsm.peak = a; fsm.t0 = now; fsm.phase = FP_POST_IMPACT;
        break;
      }
      if (a < FF_THRESH_G) {
        if (fsm.ffStart == 0) fsm.ffStart = now;
        else if (now - fsm.ffStart >= FF_MIN_MS) { fsm.phase = FP_FREEFALL; fsm.t0 = now; }
      } else {
        fsm.ffStart = 0;
      }
      break;

    case FP_FREEFALL:
      if (a >= FALL_IMPACT_G) {
        if (a >= IMPACT_G) raiseAlert(AL_IMPACT, SEV_WARNING, "event", a);
        fsm.causeImpact = false; fsm.peak = a; fsm.t0 = now; fsm.phase = FP_POST_IMPACT;
      } else if (now - fsm.t0 > FALL_WINDOW_MS) {
        fsm.phase = FP_IDLE; fsm.ffStart = 0;
      }
      break;

    case FP_POST_IMPACT:
      if (a > fsm.peak) fsm.peak = a;
      if (now - fsm.t0 >= POST_IMPACT_CHECK_MS) {
        if (mo.tiltDeg >= LYING_TILT_DEG) {
          startPrealert(fsm.causeImpact ? AL_MAN_DOWN : AL_FALL, fsm.peak);
        } else {
          fsm.phase = FP_IDLE; fsm.ffStart = 0;          // got back up
        }
      }
      break;

    case FP_PREALERT:
      break;                                              // handled in prealertTask()
  }
}

void startPrealert(AlertType t, float val) {
  if (pre.active) return;
  pre.active = true; pre.type = t; pre.start = millis(); pre.val = val;
  fsm.phase = FP_PREALERT;
  raiseAlert(t, SEV_INFO, "pending", val);               // early heads-up to the ops room
  hapticPlay(PAT_PREALERT, PAT_LEN(PAT_PREALERT), -1, true, HP_URGENT);
  Serial.println(F("[FALL] Pre-alert: short press = I'm OK, otherwise CRITICAL in 10 s"));
}

void prealertTask(uint32_t now) {
  if (!pre.active) return;
  if (btn.shortEvent) {                                   // wearer is OK
    pre.active = false;
    raiseAlert(pre.type, SEV_INFO, "cancelled", pre.val);
    hapticStop();
    hapticPlay(PAT_CONFIRM, PAT_LEN(PAT_CONFIRM), 1, false, HP_INFO);
    fsm.phase = FP_IDLE; fsm.ffStart = 0;
    btn.shortEvent = false;
  } else if (now - pre.start >= PREALERT_MS) {           // no answer -> escalate
    pre.active = false;
    raiseAlert(pre.type, SEV_CRITICAL, "event", pre.val);
    hapticStop();
    hapticPlay(PAT_CRIT, PAT_LEN(PAT_CRIT), 2, true, HP_CRIT);
    showOverlay(FRAME_ALERT, 15000);
    fsm.phase = FP_IDLE; fsm.ffStart = 0;
  }
}

// =====================================================================
//  GPS (NMEA over Serial1)
// =====================================================================
void gpsTask() {
#if HAS_GPS
  while (Serial1.available()) gps.encode((char)Serial1.read());
  if (gpsHasFix()) { gpsEverFix = true; gpsLastFix = millis(); }
#endif
}

bool gpsHasFix() {
#if HAS_GPS
  return gps.location.isValid() && gps.location.age() < 3000;
#else
  return false;
#endif
}

uint32_t gpsEpoch() {
#if HAS_GPS
  if (!gps.date.isValid() || !gps.time.isValid() || gps.time.age() > 3000) return 0;
  if (gps.date.year() < 2024) return 0;
  return toEpoch(gps.date.year(), gps.date.month(), gps.date.day(),
                 gps.time.hour(), gps.time.minute(), gps.time.second());
#else
  return 0;
#endif
}

// =====================================================================
//  Radiation (Geiger pulses -> CPM -> µSv/h, accumulated dose)
// =====================================================================
void onGeigerPulse() {
  geigerPulses++;
}

void geigerTask(uint32_t now) {
  uint32_t span = now - rad.lastBucket;
  if (span < GEIGER_BUCKET_MS) return;
  rad.lastBucket = now;

  noInterrupts();
  uint32_t c = geigerPulses;
  geigerPulses = 0;
  interrupts();

  rad.counts[rad.idx] = c;
  rad.spanMs[rad.idx] = span;                     // real span, so a blocked loop doesn't inflate CPM
  rad.idx = (rad.idx + 1) % GEIGER_BUCKETS;
  if (rad.filled < GEIGER_BUCKETS) rad.filled++;

  uint32_t sumC = 0, sumMs = 0;
  for (uint8_t i = 0; i < rad.filled; i++) { sumC += rad.counts[i]; sumMs += rad.spanMs[i]; }
  rad.cpm  = sumMs ? (sumC * 60000.0f / (float)sumMs) : 0.0f;
  rad.usvh = rad.cpm * GEIGER_USVH_PER_CPM;
  rad.doseUsv += c * GEIGER_USVH_PER_CPM / 60.0f;  // each count = factor/60 µSv
}

// =====================================================================
//  Battery
// =====================================================================
void batteryTask() {
#if HAS_BATTERY
  uint32_t sum = 0;
  for (uint8_t i = 0; i < 8; i++) sum += analogRead(PIN_BATTERY);
  float maxCount = (float)((1UL << ADC_RESOLUTION_BITS) - 1);
  bat.v = (sum / 8.0f) / maxCount * ADC_REF_V * BAT_DIVIDER_RATIO;
  bat.present = bat.v > BAT_V_PRESENT_MIN;
  float pct = (bat.v - BAT_V_EMPTY) / (BAT_V_FULL - BAT_V_EMPTY) * 100.0f;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  bat.pct = (uint8_t)pct;
#else
  bat.present = false;
#endif
}

// =====================================================================
//  SOS / cancel button
// =====================================================================
void buttonTask(uint32_t now) {
  bool raw = digitalRead(PIN_SOS_BUTTON) == LOW;     // pressed = LOW
  if (raw != btn.lastRead) { btn.lastRead = raw; btn.lastChange = now; }
  if (now - btn.lastChange >= 30 && raw != btn.stable) {   // 30 ms debounce
    btn.stable = raw;
    if (raw) { btn.pressStart = now; btn.longFired = false; }
    else if (!btn.longFired) {
      btn.shortEvent = true;
      if (!pre.active) hapticStop();                 // short press outside pre-alert = silence
    }
  }
  if (btn.stable && !btn.longFired && now - btn.pressStart >= SOS_HOLD_MS) {
    btn.longFired = true;
    triggerSOS();
  }
}

void triggerSOS() {
  if (pre.active) {                                  // help needed now: escalate the pending fall too
    pre.active = false;
    raiseAlert(pre.type, SEV_CRITICAL, "event", pre.val);
    fsm.phase = FP_IDLE; fsm.ffStart = 0;
  }
  raiseAlert(AL_SOS, SEV_CRITICAL, "event", 1);
  hapticStop();
  hapticPlay(PAT_CONFIRM, PAT_LEN(PAT_CONFIRM), 1, false, HP_CRIT);
  showOverlay(FRAME_SOS, 15000);
}

// =====================================================================
//  Rules engine (1 Hz) — condition alerts with persistence + clear
// =====================================================================
void rulesTask(uint32_t now) {
  // ---- vitals (evaluated only while the reading is valid) ----
  if (vit.hrValid) {
    uint8_t s = vit.hr >= HR_HIGH_CRIT ? SEV_CRITICAL : (vit.hr >= HR_HIGH_WARN ? SEV_WARNING : SEV_NONE);
    updateCondition(AL_HR_HIGH, s != SEV_NONE, s, vit.hr, VITAL_PERSIST_MS);
    s = vit.hr <= HR_LOW_CRIT ? SEV_CRITICAL : (vit.hr <= HR_LOW_WARN ? SEV_WARNING : SEV_NONE);
    updateCondition(AL_HR_LOW, s != SEV_NONE, s, vit.hr, VITAL_PERSIST_MS);
  }
  if (vit.spo2Valid) {
    uint8_t s = vit.spo2 < SPO2_CRIT ? SEV_CRITICAL : (vit.spo2 < SPO2_WARN ? SEV_WARNING : SEV_NONE);
    updateCondition(AL_SPO2_LOW, s != SEV_NONE, s, vit.spo2, VITAL_PERSIST_MS);
  }
  if (vit.skinTValid) {
    uint8_t s = vit.skinT >= SKIN_T_HIGH_CRIT ? SEV_CRITICAL : (vit.skinT >= SKIN_T_HIGH_WARN ? SEV_WARNING : SEV_NONE);
    updateCondition(AL_SKIN_T_HIGH, s != SEV_NONE, s, vit.skinT, VITAL_PERSIST_MS);
    updateCondition(AL_SKIN_T_LOW, vit.contact && vit.skinT < SKIN_T_LOW_WARN, SEV_WARNING, vit.skinT, VITAL_PERSIST_MS);
  }
  if (ppgOk) updateCondition(AL_SENSOR_OFF, !vit.contact, SEV_INFO, 0, CONTACT_LOST_MS);

  // ---- no motion / man down ----
  if (imuOk) {
    bool worn  = vit.contact || !ppgOk;
    bool still = (now - mo.lastActive) >= INACTIVITY_MS;
    uint8_t s  = (worn && still) ? (mo.tiltDeg >= LYING_TILT_DEG ? SEV_CRITICAL : SEV_WARNING) : SEV_NONE;
    updateCondition(AL_NO_MOTION, s != SEV_NONE, s, (now - mo.lastActive) / 1000.0f, 0);
  }

  // ---- vest temperature (IMU chip) ----
  if (imuOk && mo.chipTValid) {
    uint8_t s = mo.chipT >= VEST_T_CRIT ? SEV_CRITICAL : (mo.chipT >= VEST_T_WARN ? SEV_WARNING : SEV_NONE);
    updateCondition(AL_VEST_TEMP_HIGH, s != SEV_NONE, s, mo.chipT, VEST_T_PERSIST_MS);
  }

#if HAS_GEIGER
  // ---- radiation ----
  if (rad.filled >= 2) {                                   // need >= 10 s of counts
    uint8_t s = rad.usvh >= RAD_CRIT_USVH ? SEV_CRITICAL : (rad.usvh >= RAD_WARN_USVH ? SEV_WARNING : SEV_NONE);
    updateCondition(AL_RAD_RATE, s != SEV_NONE, s, rad.usvh, 0);
  }
  updateCondition(AL_RAD_DOSE, rad.doseUsv >= RAD_DOSE_WARN_USV, SEV_WARNING, rad.doseUsv, 0);
#endif

  // ---- battery / GPS ----
  if (bat.present) updateCondition(AL_BATTERY_LOW, bat.pct < BAT_LOW_PCT, SEV_WARNING, bat.pct, 0);
  if (gpsEverFix) updateCondition(AL_GPS_LOST, now - gpsLastFix > GPS_LOST_MS, SEV_INFO, 0, 0);
}

void updateCondition(AlertType t, bool on, uint8_t sev, float val, uint32_t persistMs) {
  ConditionAlert &c = cond[t];
  uint32_t now = millis();
  if (on) {
    if (c.since == 0) c.since = now ? now : 1;
    if (now - c.since < persistMs) return;               // not long enough yet
    if (!c.active || sev != c.sev) {                      // new, escalated or de-escalated
      bool rising = !c.active || sev > c.sev;
      c.active = true; c.sev = sev; c.lastSent = now;
      raiseAlert(t, sev, "active", val);
      if (rising && sev == SEV_CRITICAL) hapticPlay(PAT_CRIT, PAT_LEN(PAT_CRIT), 2, true, HP_CRIT);
      else if (rising && sev == SEV_WARNING) hapticPlay(PAT_WARN, PAT_LEN(PAT_WARN), 1, false, HP_WARN);
    } else if (now - c.lastSent >= ALERT_REPEAT_MS) {
      c.lastSent = now;
      raiseAlert(t, c.sev, "active", val);                // reminder while still active
    }
  } else {
    c.since = 0;
    if (c.active) {
      c.active = false;
      raiseAlert(t, SEV_INFO, "cleared", val);
      c.sev = SEV_NONE;
    }
  }
}

// Builds the alert JSON with a context snapshot; publishes or queues it.
void raiseAlert(AlertType t, uint8_t sev, const char* state, float val) {
  JsonDocument doc;
  doc["id"]    = DEVICE_ID;
  doc["seq"]   = ++alertSeq;
  doc["type"]  = ALERT_NAMES[t];
  doc["sev"]   = sev;
  doc["state"] = state;
  if (!isnan(val)) doc["val"] = rnd(val, 2);
  doc["up"]    = millis() / 1000UL;
  uint32_t ts = gpsEpoch();
  if (ts) doc["ts"] = ts;
#if HAS_GPS
  if (gpsHasFix()) {
    doc["lat"] = rnd(gps.location.lat(), 6);
    doc["lon"] = rnd(gps.location.lng(), 6);
  }
#endif
  if (vit.hrValid)   doc["hr"]   = (int)lroundf(vit.hr);
  if (vit.spo2Valid) doc["spo2"] = (int)lroundf(vit.spo2);
  if (imuOk)         doc["tilt"] = (int)lroundf(mo.tiltDeg);
  if (mo.chipTValid) doc["vest_t"] = rnd(mo.chipT, 1);
#if HAS_GEIGER
  doc["usvh"] = rnd(rad.usvh, 3);
#endif

  char buf[ALERT_JSON_MAX];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  Serial.print(F("[ALERT] ")); Serial.println(buf);
  if (!mqttPublish(topicAlert, buf, n, false, 1)) enqueueAlert(buf, n);
}

void enqueueAlert(const char* json, size_t len) {
  if (len >= ALERT_JSON_MAX) len = ALERT_JSON_MAX - 1;
  uint8_t slot = (aqHead + aqCount) % ALERT_QUEUE_LEN;
  if (aqCount == ALERT_QUEUE_LEN) {                       // full: drop the oldest
    aqHead = (aqHead + 1) % ALERT_QUEUE_LEN;
    aqCount--;
  }
  memcpy(alertQueue[slot], json, len);
  alertQueue[slot][len] = '\0';
  alertQueueLen[slot] = (uint16_t)len;
  aqCount++;
  Serial.print(F("[ALERT] queued offline (")); Serial.print(aqCount); Serial.println(F(")"));
}

void flushAlertQueue() {
  uint8_t sent = 0;
  while (aqCount > 0 && sent < 3) {                       // a few per pass, keep the loop moving
    if (!mqttPublish(topicAlert, alertQueue[aqHead], alertQueueLen[aqHead], false, 1)) return;
    aqHead = (aqHead + 1) % ALERT_QUEUE_LEN;
    aqCount--;
    sent++;
  }
}

uint32_t activeAlertMask() {
  uint32_t m = 0;
  for (uint8_t i = 0; i < AL_COUNT; i++) if (cond[i].active) m |= (1UL << i);
  if (pre.active) m |= (1UL << pre.type);
  return m;
}

uint8_t highestActiveSeverity() {
  uint8_t s = SEV_NONE;
  for (uint8_t i = 0; i < AL_COUNT; i++) if (cond[i].active && cond[i].sev > s) s = cond[i].sev;
  return s;
}

// =====================================================================
//  Connectivity: Wi-Fi + MQTT
// =====================================================================
void commsTask(uint32_t now) {
  if (!wifiTried || now - lastWifiCheck >= WIFI_CHECK_MS) {
    lastWifiCheck = now;
    wifiUp = (WiFi.status() == WL_CONNECTED);
  }
  if (!wifiUp) {
    netState = NET_NO_WIFI;
    if (!wifiTried || now - lastWifiAttempt >= WIFI_RETRY_MS) {
      wifiTried = true;
      Serial.print(F("[NET] Connecting to Wi-Fi ")); Serial.println(SECRET_SSID);
      WiFi.begin(SECRET_SSID, SECRET_PASS);          // blocks a few seconds on the R4
      lastWifiAttempt = millis();
      wifiUp = (WiFi.status() == WL_CONNECTED);
      if (wifiUp) {
        IPAddress ip = WiFi.localIP();
        Serial.print(F("[NET] Wi-Fi OK, IP ")); Serial.println(ip);
      }
    }
    return;
  }

  if (!mqtt.connected()) {
    netState = NET_NO_MQTT;
    if (!mqttTried || now - lastMqttAttempt >= MQTT_RETRY_MS) {
      wifiUp = (WiFi.status() == WL_CONNECTED);     // re-check before a (blocking) MQTT attempt
      if (!wifiUp) return;
      mqttTried = true;
      mqttConnect();
      lastMqttAttempt = millis();
    }
    return;
  }

  netState = NET_OK;
  mqtt.poll();                                       // keep-alive + incoming commands
  flushAlertQueue();
}

bool mqttConnect() {
  Serial.print(F("[MQTT] Connecting to ")); Serial.print(MQTT_HOST);
  Serial.print(':'); Serial.println(MQTT_PORT);

#if MQTT_USE_TLS && defined(SECRET_MQTT_CA_CERT)
  netClient.setCACert(SECRET_MQTT_CA_CERT);
#endif
  mqtt.setId(DEVICE_ID);
  if (strlen(SECRET_MQTT_USER) > 0) mqtt.setUsernamePassword(SECRET_MQTT_USER, SECRET_MQTT_PASS);
  mqtt.setKeepAliveInterval(MQTT_KEEPALIVE_MS);
  mqtt.setConnectionTimeout(MQTT_CONNECT_TIMEOUT_MS);
  mqtt.setCleanSession(true);

  // Last Will: the broker publishes this (retained) if the vest disappears.
  char will[64];
  int wl = snprintf(will, sizeof(will), "{\"id\":\"%s\",\"online\":false}", DEVICE_ID);
  mqtt.beginWill(topicStatus, (unsigned short)wl, true, (uint8_t)1);
  mqtt.print(will);
  mqtt.endWill();

  if (!mqtt.connect(MQTT_HOST, MQTT_PORT)) {
    Serial.print(F("[MQTT] Failed, error ")); Serial.println(mqtt.connectError());
    return false;
  }
  mqtt.subscribe(topicCmd, 1);
  Serial.println(F("[MQTT] Connected"));
  publishStatus(true);
  showOverlay(FRAME_OK, 2000);
  return true;
}

bool mqttPublish(const char* topic, const char* payload, size_t len, bool retain, uint8_t qos) {
  if (!mqtt.connected()) return false;
  if (!mqtt.beginMessage(topic, (unsigned long)len, retain, qos)) return false;
  mqtt.write((const uint8_t*)payload, len);
  return mqtt.endMessage() == 1;
}

void publishStatus(bool online) {
  JsonDocument doc;
  doc["id"]     = DEVICE_ID;
  doc["online"] = online;
  doc["fw"]     = FW_VERSION;
  IPAddress ip  = WiFi.localIP();
  char ipStr[16];
  snprintf(ipStr, sizeof(ipStr), "%u.%u.%u.%u", (unsigned)ip[0], (unsigned)ip[1], (unsigned)ip[2], (unsigned)ip[3]);
  doc["ip"]   = ipStr;
  doc["rssi"] = WiFi.RSSI();
  JsonObject s = doc["sensors"].to<JsonObject>();
  s["imu"]    = imuOk ? imuChip : "none";
  s["ppg"]    = ppgOk;
  s["temp"]   = tempOk;
#if HAS_GPS
  s["gps"]    = gps.charsProcessed() > 10;
#else
  s["gps"]    = false;
#endif
  s["geiger"] = (bool)HAS_GEIGER;
  s["bat"]    = bat.present;
  doc["interval_s"] = telemetryPeriodMs / 1000UL;
  doc["buzzer"]     = buzzerEnabled;

  char buf[256];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  mqttPublish(topicStatus, buf, n, true, 1);              // retained: dashboard sees it on connect
}

void publishTelemetry() {
  uint32_t now = millis();
  JsonDocument doc;
  doc["id"]  = DEVICE_ID;
  doc["seq"] = ++telemetrySeq;
  doc["up"]  = now / 1000UL;
  uint32_t ts = gpsEpoch();
  if (ts) doc["ts"] = ts;

#if HAS_PPG || HAS_SKIN_TEMP
  JsonObject v = doc["vit"].to<JsonObject>();
#if HAS_PPG
  v["contact"] = vit.contact;
  if (vit.hrValid)    v["hr"]     = (int)lroundf(vit.hr);    else v["hr"]     = nullptr;
  if (vit.spo2Valid)  v["spo2"]   = (int)lroundf(vit.spo2);  else v["spo2"]   = nullptr;
#endif
#if HAS_SKIN_TEMP
  if (vit.skinTValid) v["skin_t"] = rnd(vit.skinT, 1);       else v["skin_t"] = nullptr;
#endif
#endif
  if (mo.chipTValid) doc["vest_t"] = rnd(mo.chipT, 1);        // IMU chip temperature

  if (imuOk) {
    JsonObject m = doc["imu"].to<JsonObject>();
    m["peak_g"]  = rnd(mo.peakSinceTx, 2);
    m["tilt"]    = (int)lroundf(mo.tiltDeg);
    m["act"]     = rnd(mo.activity, 3);
    m["posture"] = mo.tiltDeg >= LYING_TILT_DEG ? "lying" : (mo.tiltDeg >= BENT_TILT_DEG ? "bent" : "upright");
    m["still_s"] = (now - mo.lastActive) / 1000UL;
    mo.peakSinceTx = 0;
  }

#if HAS_GPS
  JsonObject g = doc["gps"].to<JsonObject>();
  bool fix = gpsHasFix();
  g["fix"] = fix;
  if (fix) {
    g["lat"]  = rnd(gps.location.lat(), 6);
    g["lon"]  = rnd(gps.location.lng(), 6);
    g["alt"]  = rnd(gps.altitude.meters(), 1);
    g["spd"]  = rnd(gps.speed.kmph(), 1);
    g["hdop"] = rnd(gps.hdop.hdop(), 1);
  }
  g["sat"] = gps.satellites.isValid() ? gps.satellites.value() : 0;
#endif

#if HAS_GEIGER
  JsonObject r = doc["rad"].to<JsonObject>();
  r["cpm"]  = (int)lroundf(rad.cpm);
  r["usvh"] = rnd(rad.usvh, 3);
  r["dose"] = rnd(rad.doseUsv, 3);
#endif

  if (bat.present) {
    JsonObject b = doc["bat"].to<JsonObject>();
    b["v"]   = rnd(bat.v, 2);
    b["pct"] = bat.pct;
  }
  if (wifiUp) doc["rssi"] = WiFi.RSSI();
  doc["alerts"] = activeAlertMask();
  doc["pre"]    = pre.active;

  char buf[640];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  bool sent = mqttPublish(topicTelemetry, buf, n, false, 0);
  Serial.print(sent ? F("[TX] ") : F("[--] "));
  Serial.println(buf);
}

// Runs inside mqtt.poll(): copy only, act later in loop().
void onMqttMessage(int messageSize) {
  (void)messageSize;
  size_t n = 0;
  while (mqtt.available() && n < sizeof(cmdBuf) - 1) cmdBuf[n++] = (char)mqtt.read();
  while (mqtt.available()) mqtt.read();                   // drop anything too long
  cmdBuf[n] = '\0';
  cmdLen = n;
  cmdPending = true;
}

/*  Commands (JSON on sta/v1/<id>/cmd):
 *   {"cmd":"ping"}
 *   {"cmd":"ack","type":"FALL"}          ops room saw the alert -> "help is coming" buzz
 *   {"cmd":"evac"}                       evacuate signal (long pulses + buzzer)
 *   {"cmd":"stop"}                       stop vibration / buzzer
 *   {"cmd":"interval","sec":5}           telemetry period 1..60 s
 *   {"cmd":"silent","on":true}           mute / unmute the buzzer
 *   {"cmd":"calibrate"}                  wearer standing upright -> new reference
 *   {"cmd":"reset_dose"}                 start a new mission dose
 *   {"cmd":"status"}                     re-publish status
 */
void handleCommand() {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, (const char*)cmdBuf, cmdLen);
  if (err) { sendResp("?", false, "bad json"); return; }
  const char* cmd = doc["cmd"] | "";
  Serial.print(F("[CMD] ")); Serial.println(cmd);

  if (!strcmp(cmd, "ping")) {
    sendResp(cmd, true, "pong");
  } else if (!strcmp(cmd, "ack")) {
    hapticStop();
    hapticPlay(PAT_ACK, PAT_LEN(PAT_ACK), 2, false, HP_WARN);
    showOverlay(FRAME_ACK, 5000);
    sendResp(cmd, true, doc["type"] | "");
  } else if (!strcmp(cmd, "evac")) {
    hapticPlay(PAT_EVAC, PAT_LEN(PAT_EVAC), 5, true, HP_URGENT);
    showOverlay(FRAME_ALERT, 8000);
    sendResp(cmd, true, "");
  } else if (!strcmp(cmd, "stop")) {
    hapticStop();
    sendResp(cmd, true, "");
  } else if (!strcmp(cmd, "interval")) {
    int sec = doc["sec"] | 0;
    if (sec >= 1 && sec <= 60) { telemetryPeriodMs = (uint32_t)sec * 1000UL; sendResp(cmd, true, ""); }
    else sendResp(cmd, false, "sec must be 1..60");
  } else if (!strcmp(cmd, "silent")) {
    bool on = doc["on"] | true;
    buzzerEnabled = !on;
    sendResp(cmd, true, on ? "buzzer off" : "buzzer on");
  } else if (!strcmp(cmd, "calibrate")) {
    recalibrateRequested = true;
    sendResp(cmd, true, "upright reference updated");
  } else if (!strcmp(cmd, "reset_dose")) {
    rad.doseUsv = 0;
    sendResp(cmd, true, "");
  } else if (!strcmp(cmd, "status")) {
    publishStatus(true);
    sendResp(cmd, true, "");
  } else {
    sendResp(cmd, false, "unknown command");
  }
}

void sendResp(const char* cmd, bool ok, const char* info) {
  JsonDocument doc;
  doc["id"]   = DEVICE_ID;
  doc["cmd"]  = cmd;
  doc["ok"]   = ok;
  doc["info"] = info;
  doc["up"]   = millis() / 1000UL;
  char buf[160];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  mqttPublish(topicResp, buf, n, false, 1);
}

// =====================================================================
//  Wearer feedback: vibration, buzzer, LED matrix
// =====================================================================
void hapticPlay(const uint16_t* steps, uint8_t len, int16_t repeats, bool withBuzzer, uint8_t prio) {
  if (hap.steps && prio < hap.prio) return;              // don't interrupt something more important
  hap.steps = steps; hap.len = len; hap.idx = 0;
  hap.repeatsLeft = repeats; hap.stepStart = millis();
  hap.withBuzzer = withBuzzer; hap.prio = prio;
  hap.outOn = false;
}

void hapticStop() {
  hap.steps = nullptr; hap.prio = HP_NONE;
#if VIBRATION_USE_PWM
  analogWrite(PIN_VIBRATION, 0);
#else
  digitalWrite(PIN_VIBRATION, LOW);
#endif
  digitalWrite(PIN_BUZZER, LOW);
  hap.outOn = false;
}

void hapticTask(uint32_t now) {
  if (!hap.steps) return;
  if (now - hap.stepStart >= hap.steps[hap.idx]) {
    hap.stepStart = now;
    hap.idx++;
    if (hap.idx >= hap.len) {
      hap.idx = 0;
      if (hap.repeatsLeft > 0) {
        hap.repeatsLeft--;
        if (hap.repeatsLeft == 0) { hapticStop(); return; }
      }
    }
  }
  bool on = (hap.idx % 2) == 0;                          // even index = "on" step
  if (on != hap.outOn) {
    hap.outOn = on;
#if VIBRATION_USE_PWM
    analogWrite(PIN_VIBRATION, on ? VIBRATION_PWM : 0);
#else
    digitalWrite(PIN_VIBRATION, on ? HIGH : LOW);
#endif
    digitalWrite(PIN_BUZZER, (on && hap.withBuzzer && buzzerEnabled) ? HIGH : LOW);
  }
}

void showOverlay(const uint32_t* frame, uint32_t ms) {
  overlayFrame = frame;
  overlayUntil = millis() + ms;
}

void uiTask(uint32_t now) {
  blinkPhase = !blinkPhase;
  const uint32_t* f;
  if (pre.active) {
    f = blinkPhase ? FRAME_ALERT : FRAME_BLANK;                      // blinking "!" = press to cancel
  } else if (overlayFrame && (int32_t)(overlayUntil - now) > 0) {
    f = overlayFrame;
  } else if (highestActiveSeverity() == SEV_CRITICAL) {
    f = blinkPhase ? FRAME_ALERT : FRAME_BLANK;
  } else if (cond[AL_RAD_RATE].active || cond[AL_RAD_DOSE].active) {
    f = FRAME_RAD;
  } else if (highestActiveSeverity() == SEV_WARNING) {
    f = FRAME_ALERT;
  } else if (netState != NET_OK) {
    f = FRAME_NOWIFI;
  } else {
    f = FRAME_OK;
  }
  if (f != shownFrame) { matrix.loadFrame(f); shownFrame = f; }
}

// =====================================================================
//  Utilities
// =====================================================================
double rnd(double v, int decimals) {
  double p = pow(10.0, decimals);
  return round(v * p) / p;
}

// civil date -> Unix epoch (UTC), valid to 2106
uint32_t toEpoch(int y, int m, int d, int hh, int mi, int ss) {
  y -= (m <= 2) ? 1 : 0;
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153U * (unsigned)(m + (m > 2 ? -3 : 9)) + 2U) / 5U + (unsigned)d - 1U;
  const unsigned doe = yoe * 365U + yoe / 4U - yoe / 100U + doy;
  const long days = (long)era * 146097L + (long)doe - 719468L;
  return (uint32_t)days * 86400UL + (uint32_t)hh * 3600UL + (uint32_t)mi * 60UL + (uint32_t)ss;
}
