// Stage 1 host simulation: UNO R4 WiFi + IMU only (default config.h flags).
#include "Arduino.h"
#include "Wire.h"
#include "Arduino_LED_Matrix.h"
#include "ArduinoMqttClient.h"
#include "ArduinoJson.h"
#include <vector>
#include <string>

uint32_t g_ms = 0; int g_pin[32]; int g_analog[32]; int g_pwm[32]; void (*g_isr)() = nullptr;
HardwareSerial Serial, Serial1; TwoWire Wire, Wire1; WiFiClass WiFi;
SimImu g_imu = {0, 0, 1, 0, 0, 0}; float g_skinT = 0; bool g_mpuPresent = true, g_tempPresent = false;
uint8_t g_imuWho = 0x68; float g_imuTemp = 31.0f;
const uint32_t* g_frame = nullptr;
bool g_wifiUp = true, g_brokerUp = true; int g_atCalls = 0;
std::vector<SimMsg> g_published; std::deque<std::string> g_incoming;
size_t g_jsonMaxSeen = 0;

#include "SmartTacticalArmor.ino"

bool g_walk = true;
void runFor(uint32_t ms) {
  uint32_t end = g_ms + ms;
  while (g_ms < end) {
    uint32_t before = g_ms;
    if (g_walk) g_imu.az = 1.0f + 0.25f * sinf(g_ms * 0.0126f);
    loop();
    if (g_ms == before) g_ms += 1;
  }
}
size_t mark() { return g_published.size(); }
std::vector<SimMsg> since(size_t m, const char* t) { std::vector<SimMsg> v; for (size_t i = m; i < g_published.size(); i++) if (g_published[i].topic.find(t) != std::string::npos) v.push_back(g_published[i]); return v; }
bool has(const std::vector<SimMsg>& v, const char* a, const char* b = nullptr) {
  for (auto& m : v) { if (m.payload.find(a) != std::string::npos && (!b || m.payload.find(b) != std::string::npos)) return true; }
  return false;
}
void dump(const std::vector<SimMsg>& v) { for (auto& m : v) printf("   %s  %s\n", m.topic.c_str(), m.payload.c_str()); }
int fails = 0;
void check(bool ok, const char* w) { printf("  [%s] %s\n", ok ? "PASS" : "FAIL", w); if (!ok) fails++; }
void upright() { g_imu.ax = 0; g_imu.ay = 0; g_imu.az = 1; }
void doFall() { g_walk = false; g_imu.ax = 0; g_imu.ay = 0; g_imu.az = 0.1f; runFor(250); g_imu.az = 3.5f; runFor(40); g_imu.ax = 1; g_imu.az = 0.05f; runFor(100); }
void press(uint32_t ms) { g_pin[PIN_SOS_BUTTON] = LOW; runFor(ms); g_pin[PIN_SOS_BUTTON] = HIGH; runFor(100); }

int main() {
  for (int i = 0; i < 32; i++) g_pin[i] = HIGH;
  g_analog[A0] = 9000;                         // floating A0 must be ignored (HAS_BATTERY 0)
  Serial.quiet = true;
  setup(); runFor(1);

  printf("S1-A) boot with IMU only, 20 s walking\n");
  size_t m = mark(); runFor(20000);
  auto st = since(m, "/status"), tel = since(m, "/telemetry"), al = since(m, "/alert");
  check(has(st, "\"imu\":\"MPU-6050\"") && has(st, "\"gps\":false"), "status: IMU detected as MPU-6050, other sensors off");
  check(tel.size() >= 9 && has(tel, "\"vest_t\":31"), "telemetry every 2 s with vest temperature");
  check(!has(tel, "\"vit\"") && !has(tel, "\"gps\"") && !has(tel, "\"rad\"") && !has(tel, "\"bat\""), "no fields for missing sensors");
  check(al.empty(), "no alerts while walking");
  printf("   sample: %s\n", tel.back().payload.c_str());

  printf("S1-B) fall, no answer\n");
  m = mark(); doFall(); runFor(13000); al = since(m, "/alert");
  check(has(al, "\"FALL\"", "\"pending\"") && has(al, "\"FALL\"", "\"sev\":3"), "FALL pending then CRITICAL");
  check(!has(al, "\"lat\""), "alert has no GPS fields");
  dump(al);
  upright(); g_walk = true; runFor(3000);

  printf("S1-C) fall, cancelled with jumper D4->GND tap\n");
  m = mark(); doFall(); runFor(4000); press(150); runFor(500); al = since(m, "/alert");
  check(has(al, "\"FALL\"", "\"cancelled\"") && !has(al, "\"FALL\"", "\"sev\":3"), "FALL cancelled");
  upright(); g_walk = true; runFor(3000);

  printf("S1-D) SOS by holding D4 to GND 2 s\n");
  m = mark(); press(2300); check(has(since(m, "/alert"), "\"SOS\"", "\"sev\":3"), "SOS critical");

  printf("S1-E) heating the IMU (hair dryer) 50 C, then 60 C, then cool\n");
  m = mark(); g_imuTemp = 50; runFor(12000); al = since(m, "/alert");
  check(has(al, "VEST_TEMP_HIGH", "\"sev\":2"), "VEST_TEMP_HIGH warning at 50 C");
  m = mark(); g_imuTemp = 60; runFor(10000); al = since(m, "/alert");
  check(has(al, "VEST_TEMP_HIGH", "\"sev\":3"), "VEST_TEMP_HIGH critical at 60 C"); dump(al);
  m = mark(); g_imuTemp = 30; runFor(5000); al = since(m, "/alert");
  check(has(al, "VEST_TEMP_HIGH", "\"cleared\""), "cleared after cooling");
  tel = since(m, "/telemetry"); check(has(tel, "\"alerts\":0"), "alert bitmask back to 0");

  printf("S1-F) board left still on the desk 65 s\n");
  m = mark(); g_walk = false; upright(); runFor(65000); al = since(m, "/alert");
  check(has(al, "NO_MOTION", "\"sev\":2"), "NO_MOTION warning (upright, still)"); dump(al);
  g_walk = true; runFor(3000); check(has(since(m, "/alert"), "NO_MOTION", "\"cleared\""), "cleared when moved");

  printf("S1-G) MPU-6500 / 9250 chip (WHO_AM_I 0x70) temperature formula\n");
  g_imuWho = 0x70; g_imuTemp = 28.0f; mo.chipTValid = false; mpuInit(); runFor(3000);
  check(!strcmp(imuChip, "MPU-6500") && fabsf(mo.chipT - 28.0f) < 0.2f, "MPU-6500 detected, 28.0 C read correctly");

  printf("\nlargest JSON: %zu bytes\n%s (%d failures)\n", g_jsonMaxSeen, fails ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED", fails);
  return fails ? 1 : 0;
}
