#pragma once
// Minimal MPU-6050 driver over raw I2C registers (no extra library).
// Also recognises MPU-6500 / 9250 / 9255 (same registers, different
// temperature formula) because "MPU-6050" modules are often clones.
#include <Arduino.h>
#include <Wire.h>

#include "../motion/MotionAnalyzer.h"

class Mpu6050 {
 public:
  bool begin(TwoWire& wire, uint8_t address);
  bool read(ImuSample& out);
  bool ok() const { return ok_; }
  uint8_t whoAmI() const { return who_; }
  const char* chipName() const;

  // Prints every I2C address that answers (wiring diagnostics at boot).
  static void scan(TwoWire& wire, Print& out);

 private:
  bool writeRegister(uint8_t reg, uint8_t value);
  uint8_t readRegister(uint8_t reg);

  TwoWire* wire_ = nullptr;
  uint8_t address_ = 0x68;
  uint8_t who_ = 0;
  bool is6500Family_ = false;
  bool ok_ = false;
};
