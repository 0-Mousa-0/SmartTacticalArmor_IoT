#pragma once
// Minimal MAX30102 pulse-oximeter driver over raw I2C registers (no extra
// library). Also answers for a MAX30105 (same part ID and registers).
//
// Set-up: SpO2 mode (red + IR LEDs), 200 samples/s averaged by 4 on the chip
// = 50 samples/s into its 32-sample FIFO (0.64 s of data), 411 us pulses
// (18-bit), 4096 nA full scale. The FIFO rolls over if it is read too late;
// read() then reports how many samples were lost.
#include <Arduino.h>
#include <Wire.h>

struct PpgSample {
  uint32_t red;
  uint32_t ir;
};

class Max30102 {
 public:
  static constexpr float SAMPLE_RATE_HZ = 50.0f;

  // ledCurrent: 0..255 = 0..51 mA (0.2 mA per step) for both LEDs.
  bool begin(TwoWire& wire, uint8_t ledCurrent);
  bool ok() const { return ok_; }

  // Copies up to `maxSamples` from the FIFO into `out`; returns how many.
  // `lost` = samples the chip dropped because the FIFO was full.
  uint8_t read(PpgSample* out, uint8_t maxSamples, uint8_t& lost);

 private:
  bool writeRegister(uint8_t reg, uint8_t value);
  bool readRegister(uint8_t reg, uint8_t& value);

  TwoWire* wire_ = nullptr;
  bool ok_ = false;
};
