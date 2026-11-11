#pragma once
// Connectivity: Wi-Fi + MQTT (TLS) to the cloud broker, with
//   * automatic reconnection (Wi-Fi first, then MQTT),
//   * Last Will on the retained status topic (broker marks the vest offline),
//   * inbound command buffer for sta/v1/<id>/cmd,
//   * Unix time from the Wi-Fi module's NTP clock (for event timestamps).
//
// Note: WiFi.begin() and the TLS handshake are blocking calls in the UNO R4
// WiFi libraries (a few seconds). They only happen while (re)connecting.
#include <Arduino.h>
#include <ArduinoMqttClient.h>
#include <WiFiS3.h>

class MqttLink {
 public:
  enum State : uint8_t { NET_NO_WIFI = 0, NET_NO_MQTT, NET_OK };

  struct Settings {
    const char* ssid;
    const char* wifiPassword;
    const char* host;
    uint16_t port;
    bool tls;
    const char* caCert;        // nullptr = use the Wi-Fi module's built-in root CA bundle
    const char* username;
    const char* password;
    const char* deviceId;      // MQTT client id and topic segment
    const char* topicRoot;     // "sta/v1"
    uint32_t keepAliveMs;
    uint32_t connectTimeoutMs;
    uint32_t wifiRetryMs;
    uint32_t mqttRetryMs;
  };

  explicit MqttLink(const Settings& settings);

  void begin(const char* willPayload);
  void loop(uint32_t nowMs);

  State state() const { return state_; }
  bool connected() { return state_ == NET_OK && mqtt_.connected(); }
  bool takeJustConnected();  // true once after every successful (re)connect

  bool publish(const char* channel, const char* payload, size_t length, bool retain, uint8_t qos);
  bool takeCommand(char* buffer, size_t capacity, size_t& length);

  uint32_t epoch() const;    // Unix time, 0 until the NTP clock is known
  int32_t rssi() const { return WiFi.RSSI(); }
  void localIp(char* buffer, size_t capacity);

 private:
  bool connectMqtt();
  void syncClock(uint32_t nowMs);
  static void onMessage(int size);

  static MqttLink* instance_;

  Settings settings_;
  WiFiSSLClient tlsClient_;
  WiFiClient plainClient_;
  MqttClient mqtt_;
  const char* will_;
  char statusTopic_[64];
  char commandTopic_[64];

  State state_;
  bool wifiTried_, mqttTried_, justConnected_;
  uint32_t lastWifiAttempt_, lastMqttAttempt_, lastWifiCheck_;
  bool wifiUp_;

  uint32_t epochBase_, epochAtMs_, lastClockSync_;

  char command_[256];
  volatile size_t commandLength_;
  volatile bool commandPending_;
};
