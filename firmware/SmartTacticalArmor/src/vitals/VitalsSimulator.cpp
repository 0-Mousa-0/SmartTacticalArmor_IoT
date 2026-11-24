#include "VitalsSimulator.h"

#include <math.h>

namespace {
constexpr float EFFORT_BPM = 90.0f;     // heart-rate rise at full effort
constexpr float EFFORT_SCALE_G = 0.4f;  // activity that gives ~63 % of that rise
constexpr float LYING_BPM = -6.0f;
constexpr float RISE_TAU_S = 15.0f;     // the heart speeds up within ~15 s of effort ...
constexpr float FALL_TAU_S = 35.0f;     // ... and slows down more slowly afterwards
constexpr float BREATH_HZ = 0.25f;      // 15 breaths a minute
constexpr float BREATH_BPM = 1.5f;
constexpr float WANDER_BPM = 2.0f;
constexpr float SPO2_REST = 98.0f;
constexpr float SPO2_EFFORT_DIP = 1.0f;
constexpr float SPO2_TAU_S = 20.0f;
constexpr float MAX_STEP_S = 5.0f;      // a long pause (reconnect) is treated as 5 s

float clampf(float value, float lo, float hi) { return value < lo ? lo : (value > hi ? hi : value); }
int roundToInt(float value) { return static_cast<int>(floorf(value + 0.5f)); }
}  // namespace

VitalsSimulator::VitalsSimulator(float restingBpm, uint32_t seed)
    : restingBpm_(restingBpm), state_(seed ? seed : 12345), started_(false), lastMs_(0),
      bpm_(restingBpm), wander_(0), breath_(0), spo2_(SPO2_REST) {}

float VitalsSimulator::random01() {  // xorshift32
  state_ ^= state_ << 13;
  state_ ^= state_ >> 17;
  state_ ^= state_ << 5;
  return static_cast<float>(state_ & 0xFFFFFF) / static_cast<float>(0xFFFFFF);
}

float VitalsSimulator::targetBpm(float activityG, bool lying) const {
  const float activity = activityG > 0.0f ? activityG : 0.0f;
  return restingBpm_ + EFFORT_BPM * (1.0f - expf(-activity / EFFORT_SCALE_G)) + (lying ? LYING_BPM : 0.0f);
}

void VitalsSimulator::update(uint32_t nowMs, float activityG, bool lying) {
  const float target = targetBpm(activityG, lying);
  if (!started_) {  // start calm, at the level the current activity calls for
    started_ = true;
    lastMs_ = nowMs;
    bpm_ = target;
    spo2_ = SPO2_REST + (random01() - 0.5f);
    return;
  }
  const float dt = clampf(static_cast<float>(nowMs - lastMs_) / 1000.0f, 0.0f, MAX_STEP_S);
  lastMs_ = nowMs;

  const float tau = target > bpm_ ? RISE_TAU_S : FALL_TAU_S;
  bpm_ += (target - bpm_) * (1.0f - expf(-dt / tau));
  wander_ = clampf(0.97f * wander_ + (random01() - 0.5f) * 0.8f, -WANDER_BPM, WANDER_BPM);
  breath_ = BREATH_BPM * sinf(2.0f * 3.14159265f * BREATH_HZ * static_cast<float>(nowMs % 60000UL) / 1000.0f);

  const float spo2Target = SPO2_REST - (activityG > 0.6f ? SPO2_EFFORT_DIP : 0.0f);
  spo2_ += (spo2Target - spo2_) * (1.0f - expf(-dt / SPO2_TAU_S)) + (random01() - 0.5f) * 0.35f;
  spo2_ = clampf(spo2_, 96.0f, 99.4f);
}

int VitalsSimulator::heartRate() const { return roundToInt(clampf(bpm_ + wander_ + breath_, 40.0f, 200.0f)); }

int VitalsSimulator::spo2() const { return roundToInt(spo2_); }
