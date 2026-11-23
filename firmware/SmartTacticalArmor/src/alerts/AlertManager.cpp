#include "AlertManager.h"

#include <string.h>

AlertManager::AlertManager(AlertSink& sink, uint32_t reminderMs, uint32_t prealertMs)
    : sink_(sink), reminderMs_(reminderMs), prealertMs_(prealertMs), seq_(0) {
  memset(&context_, 0, sizeof(context_));
  memset(conditions_, 0, sizeof(conditions_));
  memset(&prealert_, 0, sizeof(prealert_));
}

void AlertManager::emit(AlertType type, Severity severity, AlertState state, float value) {
  AlertMessage message;
  message.seq = ++seq_;
  message.type = type;
  message.severity = severity;
  message.state = state;
  message.value = value;
  message.uptimeS = context_.uptimeS;
  message.epoch = context_.epoch;
  message.tiltDeg = context_.tiltDeg;
  message.vestTempC = context_.vestTempC;
  message.hasTemp = context_.hasTemp;
  message.hasHeartRate = context_.hasHeartRate;
  message.heartRate = context_.heartRate;
  message.hasSpo2 = context_.hasSpo2;
  message.spo2 = context_.spo2;
  sink_.onAlert(message);
}

void AlertManager::event(AlertType type, Severity severity, float value) {
  emit(type, severity, ST_EVENT, value);
}

ConditionChange AlertManager::condition(AlertType type, bool on, Severity severity, float value, uint32_t persistMs,
                                        uint32_t nowMs) {
  if (type >= AL_COUNT) return CC_NONE;
  Condition& c = conditions_[type];
  if (!on) {
    c.since = 0;
    if (!c.active) return CC_NONE;
    c.active = false;
    c.severity = SEV_NONE;
    emit(type, SEV_INFO, ST_CLEARED, value);
    return CC_CLEARED;
  }
  if (c.since == 0) c.since = nowMs ? nowMs : 1;
  if (nowMs - c.since < persistMs) return CC_NONE;  // must hold long enough first

  if (!c.active || severity != c.severity) {
    const ConditionChange change = !c.active ? CC_RAISED : (severity > c.severity ? CC_ESCALATED : CC_DEESCALATED);
    c.active = true;
    c.severity = severity;
    c.lastSent = nowMs;
    emit(type, severity, ST_ACTIVE, value);
    return change;
  }
  if (nowMs - c.lastSent >= reminderMs_) {
    c.lastSent = nowMs;
    emit(type, c.severity, ST_ACTIVE, value);  // still active: reminder for the ops room
    return CC_REMINDER;
  }
  return CC_NONE;
}

bool AlertManager::startPrealert(AlertType type, float value, uint32_t nowMs) {
  if (prealert_.active) return false;
  prealert_.active = true;
  prealert_.type = type;
  prealert_.start = nowMs;
  prealert_.value = value;
  emit(type, SEV_INFO, ST_PENDING, value);  // early heads-up to the operations room
  return true;
}

PrealertOutcome AlertManager::updatePrealert(bool wearerSaysOk, uint32_t nowMs) {
  if (!prealert_.active) return PA_NONE;
  if (wearerSaysOk) {
    prealert_.active = false;
    emit(prealert_.type, SEV_INFO, ST_CANCELLED, prealert_.value);
    return PA_CANCELLED;
  }
  if (nowMs - prealert_.start >= prealertMs_) {
    prealert_.active = false;
    emit(prealert_.type, SEV_CRITICAL, ST_EVENT, prealert_.value);
    return PA_ESCALATED;
  }
  return PA_NONE;
}

bool AlertManager::escalatePrealert() {
  if (!prealert_.active) return false;
  prealert_.active = false;
  emit(prealert_.type, SEV_CRITICAL, ST_EVENT, prealert_.value);
  return true;
}

uint32_t AlertManager::activeMask() const {
  uint32_t mask = 0;
  for (uint8_t i = 0; i < AL_COUNT; i++) {
    if (conditions_[i].active) mask |= (1UL << i);
  }
  if (prealert_.active) mask |= (1UL << prealert_.type);
  return mask;
}

Severity AlertManager::highestActive() const {
  Severity highest = SEV_NONE;
  for (uint8_t i = 0; i < AL_COUNT; i++) {
    if (conditions_[i].active && conditions_[i].severity > highest) highest = conditions_[i].severity;
  }
  return highest;
}
