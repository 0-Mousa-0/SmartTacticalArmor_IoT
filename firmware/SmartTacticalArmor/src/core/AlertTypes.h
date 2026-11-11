#pragma once
// Alert vocabulary shared by every module. Hardware-independent.
#include <stdint.h>

// Bit order = the `alerts` bitmask in telemetry (bit 0 = SOS).
// MUST match DEVICE_ALERT_BITS in backend/app/models/alert_catalog.py.
enum AlertType : uint8_t {
  AL_SOS = 0, AL_FALL, AL_IMPACT, AL_MAN_DOWN, AL_NO_MOTION,
  AL_HR_HIGH, AL_HR_LOW, AL_SPO2_LOW, AL_SKIN_T_HIGH, AL_SKIN_T_LOW,
  AL_RAD_RATE, AL_RAD_DOSE, AL_SENSOR_OFF, AL_BATTERY_LOW, AL_GPS_LOST,
  AL_VEST_TEMP_HIGH,
  AL_COUNT
};

// Wire values: 1 info, 2 warning, 3 critical.
enum Severity : uint8_t { SEV_NONE = 0, SEV_INFO = 1, SEV_WARNING = 2, SEV_CRITICAL = 3 };

// `state` field of an alert message (see docs/05-mqtt-protocol.md).
enum AlertState : uint8_t { ST_PENDING = 0, ST_EVENT, ST_ACTIVE, ST_CLEARED, ST_CANCELLED };

inline const char* alertName(AlertType type) {
  static const char* const NAMES[AL_COUNT] = {
    "SOS", "FALL", "IMPACT", "MAN_DOWN", "NO_MOTION",
    "HR_HIGH", "HR_LOW", "SPO2_LOW", "SKIN_TEMP_HIGH", "SKIN_TEMP_LOW",
    "RAD_RATE", "RAD_DOSE", "SENSOR_OFF", "BATTERY_LOW", "GPS_LOST",
    "VEST_TEMP_HIGH"};
  return type < AL_COUNT ? NAMES[type] : "UNKNOWN";
}

inline const char* stateName(AlertState state) {
  static const char* const NAMES[] = {"pending", "event", "active", "cleared", "cancelled"};
  return state <= ST_CANCELLED ? NAMES[state] : "event";
}

// One alert as it leaves the vest (built by AlertManager, sent by the app).
struct AlertMessage {
  uint16_t   seq;
  AlertType  type;
  Severity   severity;
  AlertState state;
  float      value;
  uint32_t   uptimeS;    // vest uptime when it happened
  uint32_t   epoch;      // Unix time when it happened (0 = clock not synced yet)
  float      tiltDeg;    // context snapshot for the operations room
  float      vestTempC;
  bool       hasTemp;
};
