#pragma once
// JSON payload builders — the vest side of the MQTT contract
// (docs/05-mqtt-protocol.md). ArduinoJson is header-only, so these also
// compile on a PC for unit tests.
#include <stddef.h>
#include <stdint.h>

#include "../core/AlertTypes.h"

// Where the heart rate / SpO2 come from (status message `sensors.ppg`).
enum PpgSource : uint8_t { PPG_NONE = 0, PPG_SENSOR, PPG_SIMULATED };

struct TelemetrySnapshot {
  uint32_t seq;
  uint32_t uptimeS;
  uint32_t epoch;          // 0 = clock not synced (field omitted)
  bool hasTemp;
  float vestTempC;
  bool imuOk;
  float peakG;
  float tiltDeg;
  float activityG;
  const char* posture;
  uint32_t stillS;
  bool hasRssi;
  int32_t rssi;
  uint32_t alertMask;
  bool prealert;
  bool ppgOk;              // vitals available: the "vit" section is sent
  bool vitalsSimulated;    // demo values (VitalsSimulator), marked "sim": true
  bool skinContact;
  bool hasHeartRate;       // false = not measured yet (field omitted)
  int32_t heartRate;
  bool hasSpo2;
  int32_t spo2;
};

struct StatusSnapshot {
  const char* firmware;
  const char* ip;
  int32_t rssi;
  const char* imuChip;    // "none" when not found
  uint32_t intervalS;
  bool buzzer;
  PpgSource ppg;          // MAX30102 found, simulated vitals, or none
};

size_t buildTelemetry(const char* deviceId, const TelemetrySnapshot& t, char* out, size_t capacity);
size_t buildStatus(const char* deviceId, const StatusSnapshot& s, char* out, size_t capacity);
size_t buildWill(const char* deviceId, char* out, size_t capacity);
size_t buildAlert(const char* deviceId, const AlertMessage& m, char* out, size_t capacity);
size_t buildResponse(const char* deviceId, const char* command, bool ok, const char* info, const char* correlationId,
                     uint32_t uptimeS, char* out, size_t capacity);
