#pragma once
// Heart rate and blood oxygen (SpO2) from raw MAX30102 red / infrared samples.
// Hardware-independent (no Arduino.h): unit-tested on a PC with synthetic
// pulse waves (firmware/test).
//
//   contact     IR level above a threshold for 0.5 s = a finger (or skin) covers the sensor
//   pulse       slow level (DC) and breathing drift removed (2nd-order high-pass),
//               smoothed (5 Hz low-pass) and inverted IR: one peak per heartbeat
//   heart rate  peaks above an adaptive threshold, 0.27-2 s apart (30-222 bpm); the
//               average of the recent beat intervals that agree with their median
//   SpO2        "ratio of ratios" R = (AC_red / DC_red) / (AC_ir / DC_ir) with Maxim's
//               reference curve SpO2 = -45.060 R^2 + 30.354 R + 94.845
//
// Indicator grade: not calibrated against a medical oximeter.
#include <stdint.h>

class PulseOximeter {
 public:
  struct Config {
    float sampleRateHz;     // samples per second per channel (50 with Max30102)
    uint32_t contactIrMin;  // IR level that means "on skin"
  };

  explicit PulseOximeter(const Config& config);

  void reset();
  void addSample(uint32_t red, uint32_t ir);
  // Samples were lost (FIFO overflow, long pause): do not time a beat across the gap.
  void markGap() { hasLastBeat_ = false; }

  bool contact() const { return contact_; }
  bool hasHeartRate() const;
  float heartRate() const { return hasHeartRate() ? heartRate_ : 0.0f; }
  bool hasSpo2() const { return hasHeartRate() && spo2Valid_; }
  float spo2() const { return hasSpo2() ? spo2_ : 0.0f; }
  uint32_t irLevel() const { return lastIr_; }
  bool saturated() const { return saturated_; }
  // True once per detected heartbeat (debug output, a blinking heart).
  bool takeBeat();

  static constexpr uint8_t MAX_INTERVALS = 8;

 private:
  void restartSignal();
  void onPeak(uint32_t sampleIndex);
  void updateHeartRate();
  void updateSpo2();
  float medianInterval() const;

  Config config_;
  float dcAlpha_, acAlpha_, lpAlpha_, envelopeDecay_;
  uint32_t contactOnSamples_, contactOffSamples_, settleSamples_;

  uint32_t samples_;         // since reset
  uint32_t lastIr_;
  bool contact_, saturated_;
  uint32_t pending_;         // consecutive samples disagreeing with `contact_`
  uint32_t settle_;          // samples to wait after contact before measuring

  bool dcReady_;
  float dcRed_, dcIr_;        // slow level of each colour
  float driftRed_, driftIr_;  // second high-pass stage
  float lp1Red_, lp2Red_, lp1Ir_, lp2Ir_;
  float acRed2_, acIr2_;     // mean square of the pulse part (for SpO2)
  float previous_, envelope_;
  bool rising_;

  bool hasLastBeat_;
  uint32_t lastBeat_;        // sample index of the last accepted beat
  float intervals_[MAX_INTERVALS];
  uint8_t intervalCount_, intervalHead_;

  bool heartRateValid_, spo2Valid_, beat_;
  float heartRate_, spo2_;
};
