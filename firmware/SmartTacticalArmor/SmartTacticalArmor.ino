/*
 * =====================================================================
 *  SMART TACTICAL ARMOR — vest firmware v2
 *  Phase 1 hardware: Arduino UNO R4 WiFi + MPU-6050 (GY-521)
 * =====================================================================
 *  Senses (Phase 1)
 *    - MPU-6050 accelerometer + gyroscope: fall, hard impact, man down,
 *      posture (tilt), activity, inactivity
 *    - MPU-6050 die temperature: vest / heat-exposure indicator
 *    - Optional SOS / "I'm OK" button on D4 (a jumper wire to GND works)
 *  Reports to the operations room over MQTT/TLS (EMQX Cloud):
 *    sta/v1/<id>/telemetry  every 5 s (QoS 0)      sta/v1/<id>/alert  events (QoS 1)
 *    sta/v1/<id>/status     retained + Last Will   sta/v1/<id>/resp   command answers
 *    sta/v1/<id>/cmd        commands from the ops room (ping, ack, evac, interval, ...)
 *  Wearer feedback: on-board 12x8 LED matrix (+ optional vibration / buzzer).
 *
 *  Architecture: this file is only the composition root and scheduler.
 *  Logic lives in src/ (motion, alerts, input are hardware-independent and
 *  unit-tested on a PC; sensors, net, ui talk to the hardware).
 *
 *  Libraries (Arduino IDE > Library Manager): ArduinoMqttClient, ArduinoJson 7.x
 *  Bundled with "Arduino UNO R4 Boards": WiFiS3, Wire, Arduino_LED_Matrix
 *
 *  Indicator-grade prototype — not a certified medical or safety device.
 * =====================================================================
 */
#include "config.h"

#if __has_include("arduino_secrets.h")
#include "arduino_secrets.h"
#else
#warning "arduino_secrets.h not found: building with the placeholders from arduino_secrets.example.h"
#include "arduino_secrets.example.h"
#endif

#include <Wire.h>
#include <math.h>

#include "src/alerts/AlertManager.h"
#include "src/alerts/AlertOutbox.h"
#include "src/app/CommandParser.h"
#include "src/app/Payloads.h"
#include "src/core/AlertTypes.h"
#include "src/input/SosButton.h"
#include "src/motion/FallDetector.h"
#include "src/motion/MotionAnalyzer.h"
#include "src/net/MqttLink.h"
#include "src/sensors/Mpu6050.h"
#include "src/ui/Haptics.h"
#include "src/ui/MatrixFrames.h"
#include "src/ui/StatusDisplay.h"

#if IMU_ON_QWIIC
#define SENSOR_WIRE Wire1
#else
#define SENSOR_WIRE Wire
#endif

#ifdef SECRET_MQTT_CA_CERT
static const char* const MQTT_CA_CERT = SECRET_MQTT_CA_CERT;
#else
static const char* const MQTT_CA_CERT = nullptr;  // use the Wi-Fi module's root CA bundle
#endif

// =====================================================================
//  Composition root: every module, configured from config.h
// =====================================================================
Mpu6050 imu;
MotionAnalyzer motion({STILL_ACTIVITY_G, STILL_GYRO_DPS, BENT_TILT_DEG, LYING_TILT_DEG});
FallDetector fall({FF_THRESH_G, FF_MIN_MS, FALL_IMPACT_G, FALL_WINDOW_MS, IMPACT_G, POST_IMPACT_CHECK_MS, LYING_TILT_DEG});
SosButton button(BUTTON_DEBOUNCE_MS, SOS_HOLD_MS);
Haptics haptics;
StatusDisplay display;
MqttLink link({SECRET_SSID, SECRET_PASS, MQTT_HOST, MQTT_PORT, MQTT_USE_TLS != 0, MQTT_CA_CERT, SECRET_MQTT_USER,
               SECRET_MQTT_PASS, DEVICE_ID, MQTT_TOPIC_ROOT, MQTT_KEEPALIVE_MS, MQTT_CONNECT_TIMEOUT_MS,
               WIFI_RETRY_MS, MQTT_RETRY_MS});
AlertOutbox<OUTBOX_CAPACITY> outbox;

bool sendAlert(const AlertMessage& message);

// Every alert is published at once, or kept in the outbox while offline.
class AlertRouter : public AlertSink {
 public:
  void onAlert(const AlertMessage& message) override {
    Serial.print(F("[ALERT] "));
    Serial.print(alertName(message.type));
    Serial.print(' ');
    Serial.print(stateName(message.state));
    Serial.print(F(" sev="));
    Serial.println(message.severity);
    // Keep order: if older alerts are still queued, queue behind them.
    if (!outbox.empty() || !sendAlert(message)) {
      outbox.push(message);
      Serial.print(F("[ALERT] queued offline ("));
      Serial.print(outbox.size());
      Serial.println(')');
    }
  }
};
AlertRouter router;
AlertManager alerts(router, ALERT_REMINDER_MS, PREALERT_MS);

// =====================================================================
//  State
// =====================================================================
uint32_t telemetryPeriodMs = TELEMETRY_PERIOD_MS;
uint32_t telemetrySeq = 0;
uint32_t tImu = 0, tRules = 0, tTelemetry = 0, tUi = 0;
bool wearerSaysOk = false;
char willPayload[64];

uint32_t uptimeS() { return millis() / 1000UL; }

// =====================================================================
//  Publishing
// =====================================================================
bool sendAlert(const AlertMessage& message) {
  char json[256];
  const size_t n = buildAlert(DEVICE_ID, message, json, sizeof(json));
  return link.publish("alert", json, n, false, 1);
}

void flushOutbox() {
  for (uint8_t sent = 0; sent < 3 && !outbox.empty(); sent++) {  // a few per pass: keep the loop moving
    if (!sendAlert(outbox.front())) return;
    outbox.pop();
  }
}

void publishStatus() {
  char ip[16];
  link.localIp(ip, sizeof(ip));
  StatusSnapshot status = {FW_VERSION, ip, link.rssi(), imu.ok() ? imu.chipName() : "none",
                           telemetryPeriodMs / 1000UL, haptics.buzzerEnabled()};
  char json[320];
  const size_t n = buildStatus(DEVICE_ID, status, json, sizeof(json));
  link.publish("status", json, n, true, 1);  // retained: the backend sees it on (re)connect
}

void publishTelemetry(uint32_t nowMs) {
  TelemetrySnapshot t;
  t.seq = ++telemetrySeq;
  t.uptimeS = uptimeS();
  t.epoch = link.epoch();
  t.hasTemp = imu.ok() && motion.hasTemperature();
  t.vestTempC = motion.temperatureC();
  t.imuOk = imu.ok();
  t.peakG = motion.takePeak();
  t.tiltDeg = motion.tiltDeg();
  t.activityG = motion.activity();
  t.posture = motion.postureName();
  t.stillS = motion.stillMs(nowMs) / 1000UL;
  t.hasRssi = link.state() != MqttLink::NET_NO_WIFI;
  t.rssi = t.hasRssi ? link.rssi() : 0;
  t.alertMask = alerts.activeMask();
  t.prealert = alerts.prealertActive();

  char json[384];
  const size_t n = buildTelemetry(DEVICE_ID, t, json, sizeof(json));
  const bool sent = link.publish("telemetry", json, n, false, 0);
  Serial.print(sent ? F("[TX] ") : F("[--] "));
  Serial.println(json);
}

void respond(const Command& command, bool ok, const char* info) {
  char json[192];
  const size_t n = buildResponse(DEVICE_ID, command.name, ok, info, command.correlationId, uptimeS(), json, sizeof(json));
  link.publish("resp", json, n, false, 1);
}

// =====================================================================
//  Tasks
// =====================================================================
// The wearer must stand upright and still for ~1 s at power-on: that pose
// becomes the reference for tilt (redo any time with the "calibrate" command).
void calibrateUpright() {
  float sx = 0, sy = 0, sz = 0;
  uint8_t n = 0;
  ImuSample s;
  for (uint8_t i = 0; i < 100; i++) {
    if (imu.read(s)) {
      sx += s.ax;
      sy += s.ay;
      sz += s.az;
      n++;
    }
    delay(10);
  }
  if (n > 0) motion.setReference(sx / n, sy / n, sz / n, millis());
}

void triggerSos(uint32_t nowMs) {
  if (alerts.escalatePrealert()) fall.reset();  // help is needed now: escalate a pending fall too
  alerts.event(AL_SOS, SEV_CRITICAL, 1);
  haptics.stop();
  haptics.play(PATTERN_CONFIRM, 1, false, HP_CRIT);
  display.showOverlay(FRAME_SOS, 15000, nowMs);
}

void imuTask(uint32_t nowMs) {
  ImuSample sample;
  if (!imu.read(sample)) return;
  motion.update(sample, nowMs);
  const FallEvent event = fall.update(motion.accelMagnitude(), motion.tiltDeg(), nowMs);
  switch (event) {
    case FALL_IMPACT:
      alerts.event(AL_IMPACT, SEV_WARNING, fall.peakG());
      break;
    case FALL_SUSPECTED:
    case MAN_DOWN_SUSPECTED: {
      // How it started decides the type: free fall first = FALL, hard hit first = MAN_DOWN.
      const AlertType type = event == MAN_DOWN_SUSPECTED ? AL_MAN_DOWN : AL_FALL;
      if (alerts.startPrealert(type, fall.peakG(), nowMs)) {
        haptics.play(PATTERN_PREALERT, -1, true, HP_URGENT);
        Serial.println(F("[FALL] Pre-alert: short press = I'm OK, otherwise CRITICAL in 10 s"));
      }
      break;
    }
    default:
      break;
  }
}

void buttonTask(uint32_t nowMs) {
  switch (button.update(digitalRead(PIN_SOS_BUTTON) == LOW, nowMs)) {
    case BTN_LONG:
      triggerSos(nowMs);
      break;
    case BTN_SHORT:
      if (alerts.prealertActive()) wearerSaysOk = true;
      else haptics.stop();  // short press outside a pre-alert = silence
      break;
    default:
      break;
  }
}

void prealertTask(uint32_t nowMs) {
  const PrealertOutcome outcome = alerts.updatePrealert(wearerSaysOk, nowMs);
  wearerSaysOk = false;
  if (outcome == PA_CANCELLED) {
    haptics.stop();
    haptics.play(PATTERN_CONFIRM, 1, false, HP_INFO);
    fall.reset();
  } else if (outcome == PA_ESCALATED) {
    haptics.stop();
    haptics.play(PATTERN_CRIT, 2, true, HP_CRIT);
    display.showOverlay(FRAME_ALERT, 15000, nowMs);
    fall.reset();
  }
}

void feedbackFor(ConditionChange change, Severity severity) {
  if (change != CC_RAISED && change != CC_ESCALATED) return;
  if (severity == SEV_CRITICAL) haptics.play(PATTERN_CRIT, 2, true, HP_CRIT);
  else if (severity == SEV_WARNING) haptics.play(PATTERN_WARN, 1, false, HP_WARN);
}

// 1 Hz rules: conditions that hold over time (with persistence + clear).
void rulesTask(uint32_t nowMs) {
  if (!imu.ok()) return;
  const uint32_t stillMs = motion.stillMs(nowMs);
  const bool still = stillMs >= INACTIVITY_MS;
  const Severity stillSeverity = motion.posture() == POSTURE_LYING ? SEV_CRITICAL : SEV_WARNING;
  feedbackFor(alerts.condition(AL_NO_MOTION, still, stillSeverity, stillMs / 1000.0f, 0, nowMs), stillSeverity);

  if (motion.hasTemperature()) {
    const float t = motion.temperatureC();
    const Severity heat = t >= VEST_T_CRIT ? SEV_CRITICAL : (t >= VEST_T_WARN ? SEV_WARNING : SEV_NONE);
    feedbackFor(alerts.condition(AL_VEST_TEMP_HIGH, heat != SEV_NONE, heat, t, VEST_T_PERSIST_MS, nowMs), heat);
  }
}

void commandTask(uint32_t nowMs) {
  char buffer[256];
  size_t length = 0;
  if (!link.takeCommand(buffer, sizeof(buffer), length)) return;

  Command command;
  parseCommand(buffer, length, command);
  Serial.print(F("[CMD] "));
  Serial.println(command.name);

  bool ok = true;
  const char* info = "";
  switch (command.type) {
    case CMD_PING:
      info = "pong";
      break;
    case CMD_ACK:  // ops room saw the alert: "help is coming"
      haptics.stop();
      haptics.play(PATTERN_ACK, 2, false, HP_WARN);
      display.showOverlay(FRAME_ACK, 5000, nowMs);
      info = command.alertType;
      break;
    case CMD_EVAC:
      haptics.play(PATTERN_EVAC, 5, true, HP_URGENT);
      display.showOverlay(FRAME_ALERT, 8000, nowMs);
      break;
    case CMD_STOP:
      haptics.stop();
      break;
    case CMD_INTERVAL:
      if (command.seconds >= 1 && command.seconds <= 60) {
        telemetryPeriodMs = static_cast<uint32_t>(command.seconds) * 1000UL;
      } else {
        ok = false;
        info = "sec must be 1..60";
      }
      break;
    case CMD_SILENT:
      haptics.setBuzzerEnabled(!command.on);
      info = command.on ? "buzzer off" : "buzzer on";
      break;
    case CMD_CALIBRATE:
      motion.requestRecalibration();
      info = "upright reference updated";
      break;
    case CMD_STATUS:
      publishStatus();
      break;
    case CMD_INVALID:
      ok = false;
      info = "bad json";
      break;
    default:
      ok = false;
      info = "unknown command";
      break;
  }
  respond(command, ok, info);
  if (ok && (command.type == CMD_INTERVAL || command.type == CMD_SILENT)) publishStatus();
}

// =====================================================================
//  Arduino entry points
// =====================================================================
void setup() {
  Serial.begin(115200);
  const uint32_t waitStart = millis();
  while (!Serial && millis() - waitStart < 1500) {
  }  // don't block when running on battery
  Serial.println();
  Serial.println(F("=== Smart Tactical Armor " FW_VERSION " / " DEVICE_ID " ==="));

  pinMode(PIN_SOS_BUTTON, INPUT_PULLUP);
  haptics.begin(PIN_VIBRATION, HAS_VIBRATION != 0, VIBRATION_PWM, PIN_BUZZER, HAS_BUZZER != 0);
  display.begin();

  SENSOR_WIRE.begin();
  SENSOR_WIRE.setClock(I2C_CLOCK_HZ);
  Mpu6050::scan(SENSOR_WIRE, Serial);
  if (imu.begin(SENSOR_WIRE, MPU6050_ADDR)) {
    Serial.print(F("[IMU] "));
    Serial.print(imu.chipName());
    Serial.println(F(" OK — hold the vest upright and still for 1 s..."));
    calibrateUpright();
  } else {
    Serial.println(F("[IMU] NOT FOUND — check wiring and IMU_ON_QWIIC in config.h"));
  }

  buildWill(DEVICE_ID, willPayload, sizeof(willPayload));
  link.begin(willPayload);

  const uint32_t now = millis();
  tImu = tRules = tTelemetry = tUi = now;
  Serial.println(F("[SYS] Ready"));
}

// Cooperative scheduler: no delay() anywhere in the loop.
void loop() {
  const uint32_t now = millis();
  alerts.setContext({uptimeS(), link.epoch(), motion.tiltDeg(), motion.temperatureC(), motion.hasTemperature()});

  link.loop(now);
  if (link.takeJustConnected()) {
    publishStatus();
    display.showOverlay(FRAME_OK, 2000, now);
  }
  flushOutbox();

  if (imu.ok() && now - tImu >= IMU_PERIOD_MS) {  // 100 Hz motion
    tImu += IMU_PERIOD_MS;
    if (now - tImu > 100) tImu = now;  // skip the backlog after a blocking network call
    imuTask(now);
  }

  buttonTask(now);
  prealertTask(now);
  haptics.loop(now);

  if (now - tRules >= RULES_PERIOD_MS) {
    tRules = now;
    rulesTask(now);
  }
  commandTask(now);
  if (now - tTelemetry >= telemetryPeriodMs) {
    tTelemetry = now;
    publishTelemetry(now);
  }
  if (now - tUi >= UI_PERIOD_MS) {
    tUi = now;
    display.update(now, alerts.prealertActive(), alerts.highestActive(), link.state() == MqttLink::NET_OK);
  }
}
