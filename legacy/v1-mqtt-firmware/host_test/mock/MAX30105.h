#pragma once
#include "Wire.h"
#define I2C_SPEED_STANDARD 100000
#define I2C_SPEED_FAST 400000
#define MAX30105_ADDRESS 0x57
extern bool g_ppgPresent; extern uint32_t g_ppgIr; extern uint32_t g_ppgNextSample;
class MAX30105 {
 public:
  bool begin(TwoWire& w = Wire, uint32_t speed = I2C_SPEED_STANDARD, uint8_t a = MAX30105_ADDRESS) { (void)w; (void)speed; (void)a; return g_ppgPresent; }
  void setup(byte = 0x1F, byte = 4, byte = 3, int = 400, int = 411, int = 4096) {}
  uint16_t check() { return 0; }
  uint8_t available() { return g_ms >= g_ppgNextSample ? 1 : 0; }   // 25 samples/s
  uint32_t getFIFORed() { return g_ppgIr; }
  uint32_t getFIFOIR() { return g_ppgIr; }
  void nextSample() { g_ppgNextSample += 40; }
};
