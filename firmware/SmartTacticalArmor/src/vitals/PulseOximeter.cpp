#include "PulseOximeter.h"

#include <math.h>

namespace {
constexpr float MIN_BEAT_S = 0.27f;          // 222 bpm
constexpr float MAX_BEAT_S = 2.0f;           // 30 bpm
constexpr float STALE_S = 3.0f;              // no beat for this long: heart rate unknown
constexpr uint8_t MIN_INTERVALS = 4;         // beat intervals needed before a heart rate is shown
constexpr float AGREE = 0.25f;               // an interval within ±25 % of the median counts
constexpr float PEAK_FRACTION = 0.35f;       // a beat must reach this share of the recent pulse size
constexpr float DC_TAU_S = 0.6f;             // slow average = the "DC" level (2 stages: breathing drift out)
constexpr float AC_TAU_S = 2.0f;             // averaging of the pulse power for SpO2
constexpr float ENVELOPE_TAU_S = 3.0f;       // how fast the expected pulse size forgets a big one
constexpr float LOWPASS_HZ = 5.0f;           // keeps the pulse shape, removes sensor noise
constexpr float CONTACT_ON_S = 0.5f;
constexpr float CONTACT_OFF_S = 0.2f;
constexpr float SETTLE_S = 1.5f;             // finger pressure settles after contact
constexpr uint32_t SATURATION = 0x3FFFFUL - 2048UL;  // 18-bit ADC almost at full scale
constexpr float MIN_PERFUSION = 0.0005f;     // AC/DC of the IR pulse: weaker = no usable pulse
constexpr float MAX_PERFUSION = 0.2f;        // stronger = movement, not blood
constexpr float SPO2_SMOOTHING = 0.25f;

float clampf(float value, float lo, float hi) { return value < lo ? lo : (value > hi ? hi : value); }
}  // namespace

PulseOximeter::PulseOximeter(const Config& config) : config_(config) {
  const float fs = config_.sampleRateHz > 1.0f ? config_.sampleRateHz : 50.0f;
  config_.sampleRateHz = fs;
  dcAlpha_ = 1.0f - expf(-1.0f / (fs * DC_TAU_S));
  acAlpha_ = 1.0f - expf(-1.0f / (fs * AC_TAU_S));
  lpAlpha_ = 1.0f - expf(-2.0f * 3.14159265f * LOWPASS_HZ / fs);
  envelopeDecay_ = expf(-1.0f / (fs * ENVELOPE_TAU_S));
  contactOnSamples_ = static_cast<uint32_t>(CONTACT_ON_S * fs);
  contactOffSamples_ = static_cast<uint32_t>(CONTACT_OFF_S * fs);
  settleSamples_ = static_cast<uint32_t>(SETTLE_S * fs);
  reset();
}

void PulseOximeter::reset() {
  samples_ = 0;
  lastIr_ = 0;
  contact_ = false;
  saturated_ = false;
  pending_ = 0;
  restartSignal();
}

void PulseOximeter::restartSignal() {
  settle_ = settleSamples_;
  dcReady_ = false;
  dcRed_ = dcIr_ = 0.0f;
  driftRed_ = driftIr_ = 0.0f;
  lp1Red_ = lp2Red_ = lp1Ir_ = lp2Ir_ = 0.0f;
  acRed2_ = acIr2_ = 0.0f;
  previous_ = envelope_ = 0.0f;
  rising_ = false;
  hasLastBeat_ = false;
  lastBeat_ = 0;
  intervalCount_ = intervalHead_ = 0;
  heartRateValid_ = spo2Valid_ = beat_ = false;
  heartRate_ = spo2_ = 0.0f;
}

void PulseOximeter::addSample(uint32_t red, uint32_t ir) {
  samples_++;
  lastIr_ = ir;

  // 1. Contact, with hysteresis so a shaky finger does not flicker.
  const bool covered = ir >= config_.contactIrMin;
  if (covered != contact_) {
    if (++pending_ >= (covered ? contactOnSamples_ : contactOffSamples_)) {
      contact_ = covered;
      pending_ = 0;
      restartSignal();
    }
  } else {
    pending_ = 0;
  }
  if (!contact_) return;
  saturated_ = red >= SATURATION || ir >= SATURATION;
  if (saturated_) return;  // clipped: no pulse to see (LED current too high)

  // 2. Split each channel into its slow level (DC) and the smoothed pulse (AC).
  const float r = static_cast<float>(red);
  const float i = static_cast<float>(ir);
  if (!dcReady_) {
    dcRed_ = r;
    dcIr_ = i;
    dcReady_ = true;
  }
  dcRed_ += dcAlpha_ * (r - dcRed_);
  dcIr_ += dcAlpha_ * (i - dcIr_);
  const float highRed = r - dcRed_;
  const float highIr = i - dcIr_;
  driftRed_ += dcAlpha_ * (highRed - driftRed_);
  driftIr_ += dcAlpha_ * (highIr - driftIr_);
  lp1Red_ += lpAlpha_ * ((highRed - driftRed_) - lp1Red_);
  lp2Red_ += lpAlpha_ * (lp1Red_ - lp2Red_);
  lp1Ir_ += lpAlpha_ * ((highIr - driftIr_) - lp1Ir_);
  lp2Ir_ += lpAlpha_ * (lp1Ir_ - lp2Ir_);

  // More blood absorbs more light: the IR level DROPS at each heartbeat, so the
  // inverted signal has one peak per beat.
  const float pulse = -lp2Ir_;
  if (settle_ > 0) {
    settle_--;
    previous_ = pulse;
    return;
  }

  // 3. Pulse power of each colour (SpO2) and the expected pulse size (threshold).
  acRed2_ += acAlpha_ * (lp2Red_ * lp2Red_ - acRed2_);
  acIr2_ += acAlpha_ * (lp2Ir_ * lp2Ir_ - acIr2_);
  const float size = fabsf(pulse);
  envelope_ = size > envelope_ * envelopeDecay_ ? size : envelope_ * envelopeDecay_;

  // 4. A beat = the top of a rise that is tall enough.
  const bool wasRising = rising_;
  rising_ = pulse > previous_;
  if (wasRising && !rising_ && previous_ > PEAK_FRACTION * envelope_) onPeak(samples_ - 1);
  previous_ = pulse;
}

void PulseOximeter::onPeak(uint32_t sampleIndex) {
  if (hasLastBeat_) {
    const float seconds = static_cast<float>(sampleIndex - lastBeat_) / config_.sampleRateHz;
    // Too soon after the last beat: the dicrotic wave of the same beat, or noise.
    float refractory = MIN_BEAT_S;
    if (intervalCount_ >= MIN_INTERVALS) {
      const float half = 0.5f * medianInterval();
      if (half > refractory) refractory = half;
    }
    if (seconds < refractory) return;
    if (seconds <= MAX_BEAT_S) {
      intervals_[intervalHead_] = seconds;
      intervalHead_ = static_cast<uint8_t>((intervalHead_ + 1) % MAX_INTERVALS);
      if (intervalCount_ < MAX_INTERVALS) intervalCount_++;
    }
    // Longer than MAX_BEAT_S: beats were missed; start timing again from here.
  }
  hasLastBeat_ = true;
  lastBeat_ = sampleIndex;
  beat_ = true;
  updateHeartRate();
  updateSpo2();
}

float PulseOximeter::medianInterval() const {
  float sorted[MAX_INTERVALS];
  for (uint8_t k = 0; k < intervalCount_; k++) sorted[k] = intervals_[k];
  for (uint8_t a = 1; a < intervalCount_; a++) {  // insertion sort: at most 8 values
    const float v = sorted[a];
    int8_t b = static_cast<int8_t>(a - 1);
    while (b >= 0 && sorted[b] > v) {
      sorted[b + 1] = sorted[b];
      b--;
    }
    sorted[b + 1] = v;
  }
  if (intervalCount_ == 0) return 0.0f;
  return (intervalCount_ % 2) ? sorted[intervalCount_ / 2]
                              : 0.5f * (sorted[intervalCount_ / 2 - 1] + sorted[intervalCount_ / 2]);
}

void PulseOximeter::updateHeartRate() {
  if (intervalCount_ < MIN_INTERVALS) return;
  const float median = medianInterval();
  float sum = 0.0f;
  uint8_t agreeing = 0;
  for (uint8_t k = 0; k < intervalCount_; k++) {
    if (fabsf(intervals_[k] - median) <= AGREE * median) {
      sum += intervals_[k];
      agreeing++;
    }
  }
  if (agreeing < MIN_INTERVALS || sum <= 0.0f) return;  // irregular: keep the last good value
  heartRate_ = 60.0f * agreeing / sum;
  heartRateValid_ = true;
}

void PulseOximeter::updateSpo2() {
  if (!heartRateValid_ || dcRed_ <= 0.0f || dcIr_ <= 0.0f || acIr2_ <= 0.0f) return;
  const float perfusionIr = sqrtf(acIr2_) / dcIr_;
  if (perfusionIr < MIN_PERFUSION || perfusionIr > MAX_PERFUSION) return;
  const float ratio = (sqrtf(acRed2_) / dcRed_) / perfusionIr;
  if (ratio < 0.2f || ratio > 1.15f) return;  // outside the calibration curve
  const float value = clampf(-45.060f * ratio * ratio + 30.354f * ratio + 94.845f, 70.0f, 100.0f);
  spo2_ = spo2Valid_ ? spo2_ + SPO2_SMOOTHING * (value - spo2_) : value;
  spo2Valid_ = true;
}

bool PulseOximeter::hasHeartRate() const {
  if (!contact_ || !heartRateValid_ || !hasLastBeat_) return false;
  return static_cast<float>(samples_ - lastBeat_) / config_.sampleRateHz < STALE_S;
}

bool PulseOximeter::takeBeat() {
  const bool beat = beat_;
  beat_ = false;
  return beat;
}
