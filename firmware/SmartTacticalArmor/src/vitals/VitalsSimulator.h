#pragma once
// Simulated heart rate and SpO2, for demos while no MAX30102 works.
// Hardware-independent (no Arduino.h): unit-tested on a PC.
//
// The values are random but behave like a real wearer:
//   * the heart rate follows the REAL movement measured by the MPU-6050:
//     at rest ~72 bpm, walking ~95-110, hard effort up to ~155;
//   * it changes gradually (rises within ~15 s, recovers within ~35 s),
//     with a small breathing rhythm (±1.5 bpm) and natural wander (±2 bpm);
//   * lying down lowers it a little;
//   * SpO2 stays between 96 and 99 % and dips about 1 % under hard effort.
// The vest labels these readings "simulated" (status sensors.ppg), and they
// never raise vital-sign alarms.
#include <stdint.h>

class VitalsSimulator {
 public:
  explicit VitalsSimulator(float restingBpm, uint32_t seed = 12345);

  void seed(uint32_t value) { state_ = value ? value : 12345; }
  // Call about once a second. activityG = MotionAnalyzer::activity() (0 if no IMU).
  void update(uint32_t nowMs, float activityG, bool lying);

  bool started() const { return started_; }
  int heartRate() const;  // bpm
  int spo2() const;       // %

 private:
  float random01();
  float targetBpm(float activityG, bool lying) const;

  float restingBpm_;
  uint32_t state_;
  bool started_;
  uint32_t lastMs_;
  float bpm_, wander_, breath_, spo2_;
};
