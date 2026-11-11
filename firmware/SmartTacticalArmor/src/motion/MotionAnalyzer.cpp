#include "MotionAnalyzer.h"

#include <math.h>

MotionAnalyzer::MotionAnalyzer(const Config& config)
    : config_(config),
      gravity_{0, 0, 1},
      reference_{0, 0, 1},
      aMag_(1), gyroMag_(0), tiltDeg_(0), activity_(0), peak_(0), tempC_(0),
      tempValid_(false), recalibrate_(false), lastActiveMs_(0) {}

void MotionAnalyzer::setReference(float gx, float gy, float gz, uint32_t nowMs) {
  reference_[0] = gravity_[0] = gx;
  reference_[1] = gravity_[1] = gy;
  reference_[2] = gravity_[2] = gz;
  lastActiveMs_ = nowMs;
}

void MotionAnalyzer::update(const ImuSample& s, uint32_t nowMs) {
  aMag_ = sqrtf(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
  gyroMag_ = sqrtf(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz);

  // Die temperature: heavy smoothing, it changes slowly and is noisy.
  tempC_ = tempValid_ ? (0.98f * tempC_ + 0.02f * s.tempC) : s.tempC;
  tempValid_ = true;

  // Gravity estimate: low-pass filter (~0.2 s at 100 Hz).
  const float alpha = 0.05f;
  gravity_[0] += alpha * (s.ax - gravity_[0]);
  gravity_[1] += alpha * (s.ay - gravity_[1]);
  gravity_[2] += alpha * (s.az - gravity_[2]);

  if (recalibrate_) {
    for (int i = 0; i < 3; i++) reference_[i] = gravity_[i];
    recalibrate_ = false;
  }

  // Tilt = angle between current gravity and the upright reference.
  const float dot = gravity_[0] * reference_[0] + gravity_[1] * reference_[1] + gravity_[2] * reference_[2];
  const float n1 = sqrtf(gravity_[0] * gravity_[0] + gravity_[1] * gravity_[1] + gravity_[2] * gravity_[2]);
  const float n2 = sqrtf(reference_[0] * reference_[0] + reference_[1] * reference_[1] + reference_[2] * reference_[2]);
  if (n1 > 0.2f && n2 > 0.2f) {
    float c = dot / (n1 * n2);
    if (c > 1.0f) c = 1.0f;
    if (c < -1.0f) c = -1.0f;
    tiltDeg_ = acosf(c) * 57.29578f;
  }

  // Activity = slow EMA (~1 s) of the dynamic acceleration (gravity removed).
  const float dx = s.ax - gravity_[0], dy = s.ay - gravity_[1], dz = s.az - gravity_[2];
  activity_ = 0.99f * activity_ + 0.01f * sqrtf(dx * dx + dy * dy + dz * dz);
  if (activity_ > config_.stillActivityG || gyroMag_ > config_.stillGyroDps) lastActiveMs_ = nowMs;

  if (aMag_ > peak_) peak_ = aMag_;
}

Posture MotionAnalyzer::posture() const {
  if (tiltDeg_ >= config_.lyingTiltDeg) return POSTURE_LYING;
  if (tiltDeg_ >= config_.bentTiltDeg) return POSTURE_BENT;
  return POSTURE_UPRIGHT;
}

const char* MotionAnalyzer::postureName() const {
  switch (posture()) {
    case POSTURE_LYING: return "lying";
    case POSTURE_BENT: return "bent";
    default: return "upright";
  }
}

float MotionAnalyzer::takePeak() {
  const float peak = peak_;
  peak_ = 0;
  return peak;
}
