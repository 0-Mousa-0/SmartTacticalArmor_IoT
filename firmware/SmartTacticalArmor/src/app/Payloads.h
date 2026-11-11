#pragma once
// JSON payload builders — the vest side of the MQTT contract
// (docs/05-mqtt-protocol.md). ArduinoJson is header-only, so these also
// compile on a PC for unit tests.
#include <stddef.h>
#include <stdint.h>

#include "../core/AlertTypes.h"

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
};

struct StatusSnapshot {
  const char* firmware;
  const char* ip;
  int32_t rssi;
  const char* imuChip;    // "none" when not found
  uint32_t intervalS;
  bool buzzer;
};

size_t buildTelemetry(const char* deviceId, const TelemetrySnapshot& t, char* out, size_t capacity);
size_t buildStatus(const char* deviceId, const StatusSnapshot& s, char* out, size_t capacity);
size_t buildWill(const char* deviceId, char* out, size_t capacity);
size_t buildAlert(const char* deviceId, const AlertMessage& m, char* out, size_t capacity);
size_t buildResponse(const char* deviceId, const char* command, bool ok, const char* info, const char* correlationId,
                     uint32_t uptimeS, char* out, size_t capacity);
