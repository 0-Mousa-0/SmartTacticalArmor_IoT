#pragma once
#include "WiFiS3.h"
#include <vector>
// Mock with the real ArduinoMqttClient overload set (to surface ambiguity errors)
struct SimMsg { std::string topic, payload; bool retain; int qos; };
extern std::vector<SimMsg> g_published; extern std::deque<std::string> g_incoming;
class MqttClient : public Client {
  Client* c; void (*cb)(int) = nullptr; std::string cur, curTopic; bool curRetain = false; int curQos = 0; bool inMsg = false, inWill = false;
  std::string rxPayload; size_t rxPos = 0; bool connectedFlag = false;
 public:
  MqttClient(Client* client) : c(client) {}
  MqttClient(Client& client) : c(&client) {}
  void onMessage(void (*f)(int)) { cb = f; }
  void setId(const char*) {}
  void setUsernamePassword(const char*, const char*) {}
  void setKeepAliveInterval(unsigned long) {}
  void setConnectionTimeout(unsigned long) {}
  void setCleanSession(bool) {}
  int beginWill(const char*, unsigned short, bool, uint8_t) { inWill = true; return 1; }
  int beginWill(const String&, unsigned short, bool, uint8_t) { inWill = true; return 1; }
  int beginWill(const char*, bool, uint8_t) { inWill = true; return 1; }
  int beginWill(const String&, bool, uint8_t) { inWill = true; return 1; }
  int endWill() { inWill = false; return 1; }
  int connect(IPAddress, uint16_t = 1883) { return 0; }
  int connect(const char* h, uint16_t p = 1883) override { connectedFlag = c->connect(h, p); return connectedFlag; }
  int connectError() const { return -2; }
  uint8_t connected() override { connectedFlag = connectedFlag && c->connected(); return connectedFlag; }
  int subscribe(const char*, uint8_t = 0) { return 1; }
  int subscribe(const String&, uint8_t = 0) { return 1; }
  void poll() {
    if (!g_incoming.empty() && cb) { rxPayload = g_incoming.front(); g_incoming.pop_front(); rxPos = 0; cb((int)rxPayload.size()); }
  }
  int beginMessage(const char* t, unsigned long, bool r = false, uint8_t q = 0, bool = false) { curTopic = t; curRetain = r; curQos = q; cur.clear(); inMsg = true; return 1; }
  int beginMessage(const String& t, unsigned long s, bool r = false, uint8_t q = 0, bool d = false) { return beginMessage(t.c_str(), s, r, q, d); }
  int beginMessage(const char* t, bool r = false, uint8_t q = 0, bool d = false) { return beginMessage(t, 0UL, r, q, d); }
  int beginMessage(const String& t, bool r = false, uint8_t q = 0, bool d = false) { return beginMessage(t.c_str(), 0UL, r, q, d); }
  int endMessage() { inMsg = false; g_published.push_back({curTopic, cur, curRetain, curQos}); return 1; }
  size_t write(uint8_t b) override { if (inMsg) cur.push_back((char)b); return 1; }
  size_t write(const uint8_t* b, size_t n) override { for (size_t i = 0; i < n; i++) write(b[i]); return n; }
  int available() override { return (int)(rxPayload.size() - rxPos); }
  int read() override { return rxPos < rxPayload.size() ? (uint8_t)rxPayload[rxPos++] : -1; }
  void stop() override {}
};
