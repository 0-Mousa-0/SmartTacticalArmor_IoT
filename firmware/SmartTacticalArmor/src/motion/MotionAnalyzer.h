#pragma once
// Motion analytics on top of raw IMU samples: gravity estimate, tilt against
// the calibrated upright pose, activity level, stillness and impact peaks.
// Hardware-independent (no Arduino.h) so it can be unit-tested on a PC.
#include <stdint.h>

struct ImuSample {
  float ax, ay, az;   // g
  float gx, gy, gz;   // deg/s
  float tempC;        // IMU die temperature
};

enum Posture : uint8_t { POSTURE_UPRIGHT = 0, POSTURE_BENT, POSTURE_LYING };

class MotionAnalyzer {
 public:
  struct Config {
    float stillActivityG;   // below this (and gyro below stillGyroDps) = not moving
    float stillGyroDps;
    float bentTiltDeg;
    float lyingTiltDeg;
  };

  explicit MotionAnalyzer(const Config& config);

  // Upright reference = average gravity vector while the wearer stands still.
  void setReference(float gx, float gy, float gz, uint32_t nowMs);
  void requestRecalibration() { recalibrate_ = true; }

  void update(const ImuSample& sample, uint32_t nowMs);

  float accelMagnitude() const { return aMag_; }
  float gyroMagnitude() const { return gyroMag_; }
  float tiltDeg() const { return tiltDeg_; }
  float activity() const { return activity_; }
  Posture posture() const;
  const char* postureName() const;
  uint32_t stillMs(uint32_t nowMs) const { return nowMs - lastActiveMs_; }
  bool hasTemperature() const { return tempValid_; }
  float temperatureC() const { return tempC_; }

  // Largest |a| since the previous call (one value per telemetry message).
  float takePeak();

 private:
  Config config_;
  float gravity_[3];
  float reference_[3];
  float aMag_, gyroMag_, tiltDeg_, activity_, peak_, tempC_;
  bool tempValid_, recalibrate_;
  uint32_t lastActiveMs_;
};
