#include "Haptics.h"

namespace {
const uint16_t ACK_STEPS[] = {120, 120, 120, 500};
const uint16_t WARN_STEPS[] = {200, 150, 200, 150, 200, 700};
const uint16_t CRIT_STEPS[] = {600, 200, 600, 200, 600, 900};
const uint16_t PREALERT_STEPS[] = {300, 300};
const uint16_t EVAC_STEPS[] = {1000, 300};
const uint16_t CONFIRM_STEPS[] = {800, 200};
}  // namespace

#define PATTERN_OF(steps) {steps, static_cast<uint8_t>(sizeof(steps) / sizeof(steps[0]))}
const HapticPattern PATTERN_ACK = PATTERN_OF(ACK_STEPS);
const HapticPattern PATTERN_WARN = PATTERN_OF(WARN_STEPS);
const HapticPattern PATTERN_CRIT = PATTERN_OF(CRIT_STEPS);
const HapticPattern PATTERN_PREALERT = PATTERN_OF(PREALERT_STEPS);
const HapticPattern PATTERN_EVAC = PATTERN_OF(EVAC_STEPS);
const HapticPattern PATTERN_CONFIRM = PATTERN_OF(CONFIRM_STEPS);
#undef PATTERN_OF

void Haptics::begin(int vibrationPin, bool hasVibration, uint8_t vibrationPwm, int buzzerPin, bool hasBuzzer) {
  vibrationPin_ = vibrationPin;
  hasVibration_ = hasVibration;
  vibrationPwm_ = vibrationPwm;
  buzzerPin_ = buzzerPin;
  hasBuzzer_ = hasBuzzer;
  if (hasVibration_) {
    pinMode(vibrationPin_, OUTPUT);
    digitalWrite(vibrationPin_, LOW);
  }
  if (hasBuzzer_) {
    pinMode(buzzerPin_, OUTPUT);
    digitalWrite(buzzerPin_, LOW);
  }
}

void Haptics::play(const HapticPattern& pattern, int16_t repeats, bool withBuzzer, HapticPriority priority) {
  if (pattern_.steps != nullptr && priority < priority_) return;  // never interrupt something more urgent
  pattern_ = pattern;
  index_ = 0;
  repeatsLeft_ = repeats;
  stepStart_ = millis();
  withBuzzer_ = withBuzzer;
  priority_ = priority;
  outputOn_ = false;
}

void Haptics::stop() {
  pattern_ = {nullptr, 0};
  priority_ = HP_NONE;
  drive(false);
}

void Haptics::loop(uint32_t nowMs) {
  if (pattern_.steps == nullptr) return;
  if (nowMs - stepStart_ >= pattern_.steps[index_]) {
    stepStart_ = nowMs;
    index_++;
    if (index_ >= pattern_.length) {
      index_ = 0;
      if (repeatsLeft_ > 0 && --repeatsLeft_ == 0) {
        stop();
        return;
      }
    }
  }
  const bool on = (index_ % 2) == 0;  // even steps are "on"
  if (on != outputOn_) drive(on);
}

void Haptics::drive(bool on) {
  outputOn_ = on;
  if (hasVibration_) analogWrite(vibrationPin_, on ? vibrationPwm_ : 0);
  if (hasBuzzer_) digitalWrite(buzzerPin_, (on && withBuzzer_ && buzzerEnabled_) ? HIGH : LOW);
}
