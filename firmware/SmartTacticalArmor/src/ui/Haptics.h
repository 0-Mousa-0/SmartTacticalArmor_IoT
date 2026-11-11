#pragma once
// Wearer feedback through an (optional) vibration motor and buzzer.
// Phase 1 hardware has neither: with HAS_VIBRATION / HAS_BUZZER = 0 the
// patterns still run (and drive nothing), so the logic is identical when
// the parts are added later.
#include <Arduino.h>

enum HapticPriority : uint8_t { HP_NONE = 0, HP_INFO, HP_WARN, HP_CRIT, HP_URGENT };

struct HapticPattern {
  const uint16_t* steps;  // on, off, on, off ... (ms)
  uint8_t length;
};

class Haptics {
 public:
  void begin(int vibrationPin, bool hasVibration, uint8_t vibrationPwm, int buzzerPin, bool hasBuzzer);
  void play(const HapticPattern& pattern, int16_t repeats, bool withBuzzer, HapticPriority priority);
  void stop();
  void loop(uint32_t nowMs);
  void setBuzzerEnabled(bool enabled) { buzzerEnabled_ = enabled; }
  bool buzzerEnabled() const { return buzzerEnabled_; }
  bool active() const { return pattern_.steps != nullptr; }

 private:
  void drive(bool on);

  int vibrationPin_ = -1, buzzerPin_ = -1;
  bool hasVibration_ = false, hasBuzzer_ = false, buzzerEnabled_ = true;
  uint8_t vibrationPwm_ = 170;
  HapticPattern pattern_ = {nullptr, 0};
  uint8_t index_ = 0;
  int16_t repeatsLeft_ = 0;  // -1 = until stopped
  uint32_t stepStart_ = 0;
  bool withBuzzer_ = false, outputOn_ = false;
  HapticPriority priority_ = HP_NONE;
};

// Patterns (ms)
extern const HapticPattern PATTERN_ACK;       // ops room acknowledged: help is coming
extern const HapticPattern PATTERN_WARN;
extern const HapticPattern PATTERN_CRIT;
extern const HapticPattern PATTERN_PREALERT;  // repeats until "I'm OK" or escalation
extern const HapticPattern PATTERN_EVAC;
extern const HapticPattern PATTERN_CONFIRM;
