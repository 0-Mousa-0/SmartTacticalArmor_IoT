#include "FallDetector.h"

FallDetector::FallDetector(const Config& config)
    : config_(config), phase_(IDLE), t0_(0), freeFallStart_(0), causeImpact_(false), peak_(0) {}

void FallDetector::reset() {
  phase_ = IDLE;
  freeFallStart_ = 0;
}

FallEvent FallDetector::update(float a, float tiltDeg, uint32_t nowMs) {
  switch (phase_) {
    case IDLE:
      if (a >= config_.impactG) {
        causeImpact_ = true;
        peak_ = a;
        t0_ = nowMs;
        phase_ = POST_IMPACT;
        return FALL_IMPACT;
      }
      if (a < config_.freeFallG) {
        if (freeFallStart_ == 0) {
          freeFallStart_ = nowMs ? nowMs : 1;
        } else if (nowMs - freeFallStart_ >= config_.freeFallMinMs) {
          phase_ = FREEFALL;
          t0_ = nowMs;
        }
      } else {
        freeFallStart_ = 0;
      }
      return FALL_NONE;

    case FREEFALL:
      if (a >= config_.fallImpactG) {
        causeImpact_ = false;
        peak_ = a;
        t0_ = nowMs;
        phase_ = POST_IMPACT;
        return a >= config_.impactG ? FALL_IMPACT : FALL_NONE;
      }
      if (nowMs - t0_ > config_.fallWindowMs) reset();  // no impact followed: not a fall
      return FALL_NONE;

    case POST_IMPACT:
      if (a > peak_) peak_ = a;
      if (nowMs - t0_ >= config_.postImpactCheckMs) {
        if (tiltDeg >= config_.lyingTiltDeg) {
          phase_ = WAITING;
          return causeImpact_ ? MAN_DOWN_SUSPECTED : FALL_SUSPECTED;
        }
        reset();  // got back up
      }
      return FALL_NONE;

    case WAITING:
    default:
      return FALL_NONE;  // the pre-alert decides; reset() is called afterwards
  }
}
