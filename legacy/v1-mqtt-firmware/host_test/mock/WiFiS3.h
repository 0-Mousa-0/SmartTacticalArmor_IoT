#pragma once
#include "Arduino.h"
#define WL_NO_MODULE 255
#define WL_IDLE_STATUS 0
#define WL_CONNECTED 3
#define WL_DISCONNECTED 6
#define WIFI_FIRMWARE_LATEST_VERSION "0.4.1"
extern bool g_wifiUp; extern bool g_brokerUp; extern int g_atCalls;
class IPAddress : public Printable {
 public: uint8_t b[4] = {192, 168, 1, 23};
  uint8_t operator[](int i) const { return b[i]; }
  size_t printTo(Print& p) const override { char s[20]; snprintf(s, 20, "%u.%u.%u.%u", b[0], b[1], b[2], b[3]); return p.print(s); }
};
class WiFiClass {
 public:
  int begin(const char*, const char*) { g_ms += 3000; g_atCalls++; return status(); }
  uint8_t status() { g_atCalls++; return g_wifiUp ? WL_CONNECTED : WL_DISCONNECTED; }
  int32_t RSSI() { g_atCalls++; return -61; }
  IPAddress localIP() { return IPAddress(); }
  String firmwareVersion() { return String("0.4.1"); }
};
extern WiFiClass WiFi;
class WiFiClient : public Client {
 public: bool up = false;
  int connect(const char*, uint16_t) override { g_atCalls++; up = g_wifiUp && g_brokerUp; return up; }
  int available() override { return 0; }
  int read() override { return -1; }
  void stop() override { up = false; }
  uint8_t connected() override { g_atCalls++; if (!(g_wifiUp && g_brokerUp)) up = false; return up; }
  size_t write(uint8_t) override { return 1; }
  using Print::write;
};
class WiFiSSLClient : public WiFiClient { public: void setCACert(const char* = NULL, size_t = 0) {} };
extern WiFiClass WiFi;
