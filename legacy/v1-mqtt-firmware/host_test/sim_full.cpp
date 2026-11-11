// Host simulation of the Smart Tactical Armor firmware with scripted scenarios.
#include "Arduino.h"
#include "Wire.h"
#include "MAX30105.h"
#include "TinyGPS++.h"
#include "Arduino_LED_Matrix.h"
#include "ArduinoMqttClient.h"
#include "ArduinoJson.h"
#include <vector>
#include <string>
#include <cassert>

uint32_t g_ms = 0; int g_pin[32]; int g_analog[32]; int g_pwm[32]; void (*g_isr)() = nullptr;
HardwareSerial Serial, Serial1; TwoWire Wire, Wire1; WiFiClass WiFi;
SimImu g_imu = {0, 0, 1, 0, 0, 0}; float g_skinT = 34.5f; uint8_t g_imuWho = 0x68; float g_imuTemp = 31.0f; bool g_mpuPresent = true, g_tempPresent = true;
bool g_ppgPresent = true; uint32_t g_ppgIr = 80000; uint32_t g_ppgNextSample = 0;
SimGps g_gps = {true, 24.713612, 46.675297, 612.0, 8};
const uint32_t* g_frame = nullptr;
bool g_wifiUp = true, g_brokerUp = true; int g_atCalls = 0;
std::vector<SimMsg> g_published; std::deque<std::string> g_incoming;
size_t g_jsonMaxSeen = 0;
int g_simHr = 75, g_simSpo2 = 98;
void maxim_heart_rate_and_oxygen_saturation(uint32_t*, int32_t, uint32_t*, int32_t* spo2, int8_t* sv, int32_t* hr, int8_t* hv) {
  *hr = g_simHr; *hv = 1; *spo2 = g_simSpo2; *sv = 1;
}

#include "SmartTacticalArmor.ino"

double g_cpm = 20; double g_pulseAcc = 0; bool g_walk = true;
void runFor(uint32_t ms) {
  uint32_t end = g_ms + ms;
  while (g_ms < end) {
    uint32_t before = g_ms;
    if (g_walk) { g_imu.az = 1.0f + 0.25f * sinf(g_ms * 0.0126f); }   // ~2 Hz gait bounce
    loop();
    if (g_ms == before) g_ms += 1;
    g_pulseAcc += g_cpm / 60000.0 * (g_ms - before ? (g_ms - before) : 1);
    while (g_pulseAcc >= 1.0 && g_isr) { g_isr(); g_pulseAcc -= 1.0; }
  }
}
size_t mark() { return g_published.size(); }
std::vector<SimMsg> since(size_t m, const char* topicPart) {
  std::vector<SimMsg> v; for (size_t i = m; i < g_published.size(); i++) if (g_published[i].topic.find(topicPart) != std::string::npos) v.push_back(g_published[i]); return v;
}
bool has(const std::vector<SimMsg>& v, const char* a, const char* b = nullptr) {
  for (auto& m : v) { if (m.payload.find(a) != std::string::npos && (!b || m.payload.find(b) != std::string::npos)) return true; }
  return false;
}
void dump(const std::vector<SimMsg>& v) { for (auto& m : v) printf("   %s  %s\n", m.topic.c_str(), m.payload.c_str()); }
int fails = 0;
void check(bool ok, const char* what) { printf("  [%s] %s\n", ok ? "PASS" : "FAIL", what); if (!ok) fails++; }
void setUpright() { g_imu.ax = 0; g_imu.ay = 0; g_imu.az = 1; }
void doFall(bool bigImpact) {
  g_walk = false;
  g_imu.ax = 0; g_imu.ay = 0; g_imu.az = 0.1f; runFor(250);              // free fall
  g_imu.az = bigImpact ? 9.0f : 3.5f; runFor(40);                          // impact
  g_imu.ax = 1; g_imu.ay = 0; g_imu.az = 0.05f; runFor(100);               // lying on the side
}
void pressButton(uint32_t ms) { g_pin[PIN_SOS_BUTTON] = LOW; runFor(ms); g_pin[PIN_SOS_BUTTON] = HIGH; runFor(100); }

int main() {
  for (int i = 0; i < 32; i++) g_pin[i] = HIGH;
  g_analog[A0] = (int)(7.8f / BAT_DIVIDER_RATIO / 5.0f * 16383);
  Serial.quiet = true;
  setup();
  runFor(1);

  printf("A) boot + normal operation 20 s\n");
  size_t m = mark(); runFor(20000);
  auto st = since(m, "/status"), tel = since(m, "/telemetry"), al = since(m, "/alert");
  check(!st.empty() && st[0].retain && has(st, "\"online\":true"), "retained online status published");
  check(tel.size() >= 9 && tel.size() <= 11, "telemetry every 2 s");
  check(has(tel, "\"hr\":75", "\"spo2\":98"), "vitals in telemetry");
  check(has(tel, "\"lat\":24.713612") && has(tel, "\"posture\":\"upright\""), "gps + posture in telemetry");
  check(al.empty(), "no alerts in normal operation");
  printf("   sample: %s\n", tel.back().payload.c_str());
  printf("   bat: %s\n", strstr(tel.back().payload.c_str(), "\"bat\"") ? "present" : "missing");

  printf("B) heart rate 172 bpm sustained, then back to 75\n");
  m = mark(); g_simHr = 172; runFor(25000);
  al = since(m, "/alert");
  check(has(al, "HR_HIGH", "\"state\":\"active\""), "HR_HIGH active (warning)"); dump(al);
  m = mark(); g_simHr = 75; runFor(12000); al = since(m, "/alert");
  check(has(al, "HR_HIGH", "\"cleared\""), "HR_HIGH cleared");

  printf("C) fall, no answer -> critical\n");
  m = mark(); doFall(false); runFor(3000);
  al = since(m, "/alert");
  check(has(al, "\"FALL\"", "\"pending\""), "FALL pending sent to ops (pre-alert)");
  check(g_pwm[PIN_VIBRATION] > 0 || hap.steps != nullptr, "wearer vibration running");
  runFor(10000); al = since(m, "/alert");
  check(has(al, "\"FALL\"", "\"sev\":3"), "FALL escalated to CRITICAL after 10 s"); dump(al);
  setUpright(); g_walk = true; runFor(3000);

  printf("D) fall, wearer presses button -> cancelled\n");
  m = mark(); doFall(false); runFor(4000); pressButton(150); runFor(500);
  al = since(m, "/alert");
  check(has(al, "\"FALL\"", "\"cancelled\"") && !has(al, "\"FALL\"", "\"sev\":3"), "FALL cancelled by wearer");
  setUpright(); g_walk = true; runFor(3000);

  printf("E) hard impact (9 g) while staying upright\n");
  m = mark(); g_walk = false; g_imu.az = 9.0f; runFor(30); setUpright(); g_walk = true; runFor(4000);
  al = since(m, "/alert");
  check(has(al, "IMPACT", "\"sev\":2") && !has(al, "MAN_DOWN"), "IMPACT warning, no man-down"); dump(al);

  printf("F) SOS long press\n");
  m = mark(); pressButton(2300); al = since(m, "/alert");
  check(has(al, "\"SOS\"", "\"sev\":3"), "SOS critical");

  printf("G) radiation 300 CPM then 1600 CPM then background\n");
  m = mark(); g_cpm = 300; runFor(40000); al = since(m, "/alert");
  check(has(al, "RAD_RATE", "\"sev\":2"), "RAD_RATE warning at ~2.4 uSv/h");
  m = mark(); g_cpm = 1600; runFor(70000); al = since(m, "/alert");
  check(has(al, "RAD_RATE", "\"sev\":3"), "RAD_RATE critical at ~13 uSv/h"); dump(al);
  m = mark(); g_cpm = 20; runFor(70000); al = since(m, "/alert");
  check(has(al, "RAD_RATE", "\"cleared\""), "RAD_RATE cleared after window drains");
  printf("   dose so far: %.2f uSv\n", rad.doseUsv);

  printf("H) broker down: SOS queued, delivered after reconnect\n");
  g_brokerUp = false; runFor(3000);
  m = mark(); pressButton(2300); runFor(2000);
  check(!has(since(m, "/alert"), "\"SOS\""), "SOS not delivered while offline");
  check(aqCount >= 1, "SOS held in offline queue");
  g_brokerUp = true; runFor(8000);
  al = since(m, "/alert");
  check(has(al, "\"SOS\""), "queued SOS delivered after reconnect");
  check(has(since(m, "/status"), "\"online\":true"), "status re-published on reconnect");

  printf("I) commands from ops room\n");
  m = mark();
  g_incoming.push_back("{\"cmd\":\"interval\",\"sec\":5}"); runFor(200);
  g_incoming.push_back("{\"cmd\":\"ack\",\"type\":\"SOS\"}"); runFor(200);
  g_incoming.push_back("not json"); runFor(200);
  g_incoming.push_back("{\"cmd\":\"silent\",\"on\":true}"); runFor(200);
  auto rs = since(m, "/resp");
  check(has(rs, "\"interval\"", "\"ok\":true") && has(rs, "\"ack\"", "\"ok\":true"), "interval + ack accepted");
  check(has(rs, "bad json") && has(rs, "buzzer off"), "bad json rejected, silent applied"); dump(rs);
  size_t m2 = mark(); runFor(20000);
  size_t n5 = since(m2, "/telemetry").size();
  check(n5 >= 3 && n5 <= 5, "telemetry now every 5 s");

  printf("J) lying still after a fall -> NO_MOTION critical\n");
  m = mark(); doFall(false); runFor(13000); runFor(62000);
  al = since(m, "/alert");
  check(has(al, "NO_MOTION", "\"sev\":3"), "NO_MOTION critical when lying still 60 s");
  setUpright(); g_walk = true; runFor(5000);
  check(has(since(m, "/alert"), "NO_MOTION", "\"cleared\""), "NO_MOTION cleared when moving");

  printf("K) sensor taken off skin\n");
  m = mark(); g_ppgIr = 5000; runFor(15000); al = since(m, "/alert");
  check(has(al, "SENSOR_OFF"), "SENSOR_OFF info");
  tel = since(m, "/telemetry"); check(has(tel, "\"hr\":null"), "hr reported as null without contact");
  g_ppgIr = 80000; runFor(8000);

  printf("\nlargest JSON: %zu bytes (telemetry buffer 640, alert buffer %d)\n", g_jsonMaxSeen, ALERT_JSON_MAX);
  printf("AT calls per second (avg over run): %.1f\n", g_atCalls / (g_ms / 1000.0));
  printf("%s (%d failures)\n", fails ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED", fails);
  return fails ? 1 : 0;
}
