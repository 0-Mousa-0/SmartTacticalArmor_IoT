#pragma once
// Alert lifecycle on the vest (hardware-independent):
//   * events      — one-shot alerts (SOS, IMPACT)                 -> state "event"
//   * conditions  — true while a condition lasts, with persistence,
//                   escalation / de-escalation, 30 s reminders     -> "active" / "cleared"
//   * pre-alert   — suspected fall: the wearer has PREALERT_MS to press
//                   "I'm OK" before it becomes critical            -> "pending" / "cancelled" / "event"
// Every outgoing alert goes to an AlertSink (the app publishes or queues it).
#include <stdint.h>

#include "../core/AlertTypes.h"

class AlertSink {
 public:
  virtual ~AlertSink() {}
  virtual void onAlert(const AlertMessage& message) = 0;
};

struct AlertContext {
  uint32_t uptimeS;
  uint32_t epoch;
  float tiltDeg;
  float vestTempC;
  bool hasTemp;
};

enum ConditionChange : uint8_t { CC_NONE = 0, CC_RAISED, CC_ESCALATED, CC_DEESCALATED, CC_REMINDER, CC_CLEARED };
enum PrealertOutcome : uint8_t { PA_NONE = 0, PA_CANCELLED, PA_ESCALATED };

class AlertManager {
 public:
  AlertManager(AlertSink& sink, uint32_t reminderMs, uint32_t prealertMs);

  void setContext(const AlertContext& context) { context_ = context; }

  void event(AlertType type, Severity severity, float value);
  ConditionChange condition(AlertType type, bool on, Severity severity, float value, uint32_t persistMs,
                            uint32_t nowMs);

  bool startPrealert(AlertType type, float value, uint32_t nowMs);
  PrealertOutcome updatePrealert(bool wearerSaysOk, uint32_t nowMs);
  bool escalatePrealert();  // e.g. SOS held during a pre-alert
  bool prealertActive() const { return prealert_.active; }

  uint32_t activeMask() const;
  Severity highestActive() const;
  bool isActive(AlertType type) const { return type < AL_COUNT && conditions_[type].active; }

 private:
  struct Condition {
    bool active;
    Severity severity;
    uint32_t since;      // when the condition became true (0 = false)
    uint32_t lastSent;
  };
  struct Prealert {
    bool active;
    AlertType type;
    uint32_t start;
    float value;
  };

  void emit(AlertType type, Severity severity, AlertState state, float value);

  AlertSink& sink_;
  uint32_t reminderMs_, prealertMs_;
  uint16_t seq_;
  AlertContext context_;
  Condition conditions_[AL_COUNT];
  Prealert prealert_;
};
