#include "Payloads.h"

#include <ArduinoJson.h>
#include <math.h>

namespace {
double rounded(double value, int decimals) {
  const double factor = pow(10.0, decimals);
  return round(value * factor) / factor;
}
}  // namespace

size_t buildTelemetry(const char* deviceId, const TelemetrySnapshot& t, char* out, size_t capacity) {
  JsonDocument doc;
  doc["id"] = deviceId;
  doc["seq"] = t.seq;
  doc["up"] = t.uptimeS;
  if (t.epoch) doc["ts"] = t.epoch;
  if (t.hasTemp) doc["vest_t"] = rounded(t.vestTempC, 1);  // IMU die temperature
  if (t.imuOk) {
    JsonObject imu = doc["imu"].to<JsonObject>();
    imu["peak_g"] = rounded(t.peakG, 2);
    imu["tilt"] = static_cast<int>(lroundf(t.tiltDeg));
    imu["act"] = rounded(t.activityG, 3);
    imu["posture"] = t.posture;
    imu["still_s"] = t.stillS;
  }
  if (t.ppgOk) {
    JsonObject vit = doc["vit"].to<JsonObject>();
    vit["contact"] = t.skinContact;
    if (t.hasHeartRate) vit["hr"] = t.heartRate;
    if (t.hasSpo2) vit["spo2"] = t.spo2;
  }
  if (t.hasRssi) doc["rssi"] = t.rssi;
  doc["alerts"] = t.alertMask;
  doc["pre"] = t.prealert;
  return serializeJson(doc, out, capacity);
}

size_t buildStatus(const char* deviceId, const StatusSnapshot& s, char* out, size_t capacity) {
  JsonDocument doc;
  doc["id"] = deviceId;
  doc["online"] = true;
  doc["fw"] = s.firmware;
  doc["ip"] = s.ip;
  doc["rssi"] = s.rssi;
  JsonObject sensors = doc["sensors"].to<JsonObject>();
  sensors["imu"] = s.imuChip;
  sensors["ppg"] = s.ppg;     // MAX30102 heart rate / SpO2
  sensors["temp"] = false;    // Phase 2: MAX30205 skin temperature
  sensors["gps"] = false;     // Phase 3: GPS
  sensors["geiger"] = false;  // Phase 4: radiation
  sensors["bat"] = false;     // Phase 2: battery monitor
  doc["interval_s"] = s.intervalS;
  doc["buzzer"] = s.buzzer;
  return serializeJson(doc, out, capacity);
}

size_t buildWill(const char* deviceId, char* out, size_t capacity) {
  JsonDocument doc;
  doc["id"] = deviceId;
  doc["online"] = false;
  return serializeJson(doc, out, capacity);
}

size_t buildAlert(const char* deviceId, const AlertMessage& m, char* out, size_t capacity) {
  JsonDocument doc;
  doc["id"] = deviceId;
  doc["seq"] = m.seq;
  doc["type"] = alertName(m.type);
  doc["sev"] = static_cast<int>(m.severity);
  doc["state"] = stateName(m.state);
  if (!isnan(m.value)) doc["val"] = rounded(m.value, 2);
  doc["up"] = m.uptimeS;
  if (m.epoch) doc["ts"] = m.epoch;
  doc["tilt"] = static_cast<int>(lroundf(m.tiltDeg));
  if (m.hasTemp) doc["vest_t"] = rounded(m.vestTempC, 1);
  if (m.hasHeartRate) doc["hr"] = static_cast<int>(lroundf(m.heartRate));
  if (m.hasSpo2) doc["spo2"] = static_cast<int>(lroundf(m.spo2));
  return serializeJson(doc, out, capacity);
}

size_t buildResponse(const char* deviceId, const char* command, bool ok, const char* info, const char* correlationId,
                     uint32_t uptimeS, char* out, size_t capacity) {
  JsonDocument doc;
  doc["id"] = deviceId;
  doc["cmd"] = command;
  doc["ok"] = ok;
  doc["info"] = info;
  doc["up"] = uptimeS;
  if (correlationId != nullptr && correlationId[0] != '\0') doc["cid"] = correlationId;  // echoed for matching
  return serializeJson(doc, out, capacity);
}
