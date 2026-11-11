#pragma once
#include "Arduino.h"
// Mock of the UNO R4 (Renesas core) TwoWire API with simulated MPU-6050 and MAX30205
struct SimImu { float ax, ay, az, gx, gy, gz; };
extern SimImu g_imu; extern float g_skinT; extern uint8_t g_imuWho; extern float g_imuTemp; extern bool g_mpuPresent, g_tempPresent;
class TwoWire {
  uint8_t addr = 0, reg = 0; std::deque<uint8_t> rx;
 public:
  void begin() {}
  void setClock(uint32_t) {}
  void beginTransmission(uint32_t a) { addr = (uint8_t)a; first = true; }
  void beginTransmission(uint16_t a) { beginTransmission((uint32_t)a); }
  void beginTransmission(uint8_t a) { beginTransmission((uint32_t)a); }
  void beginTransmission(int a) { beginTransmission((uint32_t)a); }
  bool first = true;
  size_t write(uint8_t b) { if (first) { reg = b; first = false; } return 1; }
  size_t write(const uint8_t* b, size_t n) { for (size_t i = 0; i < n; i++) write(b[i]); return n; }
  uint8_t endTransmission(bool) { return present() ? 0 : 2; }
  uint8_t endTransmission(void) { return endTransmission(true); }
  bool present() { return (addr == 0x68 && g_mpuPresent) || (addr == 0x48 && g_tempPresent); }
  size_t requestFrom(uint8_t a, size_t n, bool) { return requestFrom(a, n); }
  size_t requestFrom(uint8_t a, size_t n) {
    rx.clear(); addr = a; if (!present()) return 0;
    auto put16 = [&](float v) { int16_t r = (int16_t)lroundf(v); rx.push_back((uint8_t)(r >> 8)); rx.push_back((uint8_t)r); };
    if (a == 0x48) { put16(g_skinT * 256.0f); }
    if (a == 0x68 && reg == 0x75) { rx.push_back(g_imuWho); }
    if (a == 0x68 && reg == 0x3B) {
      bool f65 = (g_imuWho == 0x70 || g_imuWho == 0x71 || g_imuWho == 0x73);
      float rawT = f65 ? (g_imuTemp - 21.0f) * 333.87f : (g_imuTemp - 36.53f) * 340.0f;
      put16(g_imu.ax * 2048); put16(g_imu.ay * 2048); put16(g_imu.az * 2048); put16(rawT);
      put16(g_imu.gx * 16.4f); put16(g_imu.gy * 16.4f); put16(g_imu.gz * 16.4f);
    }
    while (rx.size() > n) rx.pop_back();
    return rx.size();
  }
  int available() { return (int)rx.size(); }
  int read() { if (rx.empty()) return -1; int c = rx.front(); rx.pop_front(); return c; }
};
extern TwoWire Wire, Wire1;
