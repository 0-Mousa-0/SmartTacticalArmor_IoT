#pragma once
// Fall / man-down detection state machine (hardware-independent).
//
//   IDLE --|a| < freeFall for freeFallMinMs--> FREEFALL --|a| >= fallImpact--> POST_IMPACT
//   IDLE --|a| >= impact (hard hit)-----------------------------------------> POST_IMPACT
//   POST_IMPACT --after postImpactCheckMs: lying--> WAITING  (FALL / MAN_DOWN suspected)
//                                       upright--> IDLE     (got back up)
//   WAITING --reset() once the pre-alert is answered or escalated--> IDLE
#include <stdint.h>

enum FallEvent : uint8_t {
  FALL_NONE = 0,
  FALL_IMPACT,          // hard hit (>= impact g), reported immediately
  FALL_SUSPECTED,       // free fall + impact + lying
  MAN_DOWN_SUSPECTED,   // hard impact + lying
};

class FallDetector {
 public:
  struct Config {
    float freeFallG;           // |a| below this = free fall
    uint32_t freeFallMinMs;    // ... for at least this long
    float fallImpactG;         // impact that must follow the free fall
    uint32_t fallWindowMs;     // max time between free fall and impact
    float impactG;             // hard hit with or without a fall
    uint32_t postImpactCheckMs;
    float lyingTiltDeg;
  };

  explicit FallDetector(const Config& config);

  FallEvent update(float accelG, float tiltDeg, uint32_t nowMs);
  void reset();
  bool waiting() const { return phase_ == WAITING; }
  float peakG() const { return peak_; }

 private:
  enum Phase : uint8_t { IDLE, FREEFALL, POST_IMPACT, WAITING };
  Config config_;
  Phase phase_;
  uint32_t t0_, freeFallStart_;
  bool causeImpact_;
  float peak_;
};
