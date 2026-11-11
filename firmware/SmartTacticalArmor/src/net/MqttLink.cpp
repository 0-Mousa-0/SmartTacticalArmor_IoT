#include "MqttLink.h"

MqttLink* MqttLink::instance_ = nullptr;

MqttLink::MqttLink(const Settings& settings)
    : settings_(settings),
      mqtt_(settings.tls ? static_cast<Client&>(tlsClient_) : static_cast<Client&>(plainClient_)),
      will_(nullptr),
      state_(NET_NO_WIFI),
      wifiTried_(false), mqttTried_(false), justConnected_(false),
      lastWifiAttempt_(0), lastMqttAttempt_(0), lastWifiCheck_(0), wifiUp_(false),
      epochBase_(0), epochAtMs_(0), lastClockSync_(0),
      commandLength_(0), commandPending_(false) {
  snprintf(statusTopic_, sizeof(statusTopic_), "%s/%s/status", settings.topicRoot, settings.deviceId);
  snprintf(commandTopic_, sizeof(commandTopic_), "%s/%s/cmd", settings.topicRoot, settings.deviceId);
  command_[0] = '\0';
}

void MqttLink::begin(const char* willPayload) {
  instance_ = this;
  will_ = willPayload;
  if (settings_.tls && settings_.caCert != nullptr) tlsClient_.setCACert(settings_.caCert);
  mqtt_.onMessage(MqttLink::onMessage);
  if (WiFi.status() == WL_NO_MODULE) {
    Serial.println(F("[NET] Wi-Fi module not responding!"));
    return;
  }
  Serial.print(F("[NET] Wi-Fi module firmware "));
  Serial.println(WiFi.firmwareVersion());
}

void MqttLink::loop(uint32_t nowMs) {
  if (!wifiTried_ || nowMs - lastWifiCheck_ >= 1000) {
    lastWifiCheck_ = nowMs;
    wifiUp_ = (WiFi.status() == WL_CONNECTED);
  }

  if (!wifiUp_) {
    state_ = NET_NO_WIFI;
    if (!wifiTried_ || nowMs - lastWifiAttempt_ >= settings_.wifiRetryMs) {
      wifiTried_ = true;
      Serial.print(F("[NET] Connecting to Wi-Fi "));
      Serial.println(settings_.ssid);
      WiFi.begin(settings_.ssid, settings_.wifiPassword);  // blocks a few seconds
      lastWifiAttempt_ = millis();
      wifiUp_ = (WiFi.status() == WL_CONNECTED);
      if (wifiUp_) {
        Serial.print(F("[NET] Wi-Fi OK, IP "));
        Serial.println(WiFi.localIP());
      }
    }
    return;
  }

  syncClock(nowMs);

  if (!mqtt_.connected()) {
    state_ = NET_NO_MQTT;
    if (!mqttTried_ || nowMs - lastMqttAttempt_ >= settings_.mqttRetryMs) {
      mqttTried_ = true;
      if (connectMqtt()) justConnected_ = true;
      lastMqttAttempt_ = millis();
    }
    return;
  }

  state_ = NET_OK;
  mqtt_.poll();  // keep-alive + incoming commands (copied in onMessage)
}

bool MqttLink::connectMqtt() {
  Serial.print(F("[MQTT] Connecting to "));
  Serial.print(settings_.host);
  Serial.print(':');
  Serial.println(settings_.port);

  mqtt_.setId(settings_.deviceId);
  if (settings_.username != nullptr && settings_.username[0] != '\0') {
    mqtt_.setUsernamePassword(settings_.username, settings_.password);
  }
  mqtt_.setKeepAliveInterval(settings_.keepAliveMs);
  mqtt_.setConnectionTimeout(settings_.connectTimeoutMs);
  mqtt_.setCleanSession(true);

  if (will_ != nullptr) {
    // Retained Last Will: if the vest vanishes, the broker tells everyone.
    mqtt_.beginWill(statusTopic_, static_cast<unsigned short>(strlen(will_)), true, 1);
    mqtt_.print(will_);
    mqtt_.endWill();
  }

  if (!mqtt_.connect(settings_.host, settings_.port)) {
    Serial.print(F("[MQTT] Failed, error "));
    Serial.println(mqtt_.connectError());  // -2 = refused (credentials / ACL), -1 = timeout
    return false;
  }
  mqtt_.subscribe(commandTopic_, 1);
  state_ = NET_OK;
  Serial.println(F("[MQTT] Connected"));
  return true;
}

bool MqttLink::takeJustConnected() {
  const bool value = justConnected_;
  justConnected_ = false;
  return value;
}

bool MqttLink::publish(const char* channel, const char* payload, size_t length, bool retain, uint8_t qos) {
  if (state_ != NET_OK || !mqtt_.connected()) return false;
  char topic[72];
  snprintf(topic, sizeof(topic), "%s/%s/%s", settings_.topicRoot, settings_.deviceId, channel);
  if (!mqtt_.beginMessage(topic, static_cast<unsigned long>(length), retain, qos)) return false;
  mqtt_.write(reinterpret_cast<const uint8_t*>(payload), length);
  return mqtt_.endMessage() == 1;
}

// Called from inside mqtt_.poll(): copy only, the app acts on it later in loop().
void MqttLink::onMessage(int size) {
  (void)size;
  if (instance_ == nullptr) return;
  MqttLink& self = *instance_;
  size_t n = 0;
  while (self.mqtt_.available() && n < sizeof(self.command_) - 1) {
    self.command_[n++] = static_cast<char>(self.mqtt_.read());
  }
  while (self.mqtt_.available()) self.mqtt_.read();  // drop anything too long
  self.command_[n] = '\0';
  self.commandLength_ = n;
  self.commandPending_ = true;
}

bool MqttLink::takeCommand(char* buffer, size_t capacity, size_t& length) {
  if (!commandPending_) return false;
  length = commandLength_ < capacity - 1 ? commandLength_ : capacity - 1;
  memcpy(buffer, command_, length);
  buffer[length] = '\0';
  commandPending_ = false;
  return true;
}

void MqttLink::syncClock(uint32_t nowMs) {
  // Ask the Wi-Fi module for NTP time: every 30 s until known, then hourly.
  const uint32_t interval = epochBase_ ? 3600000UL : 30000UL;
  if (lastClockSync_ != 0 && nowMs - lastClockSync_ < interval) return;
  lastClockSync_ = nowMs ? nowMs : 1;
  const unsigned long now = WiFi.getTime();
  if (now > 1700000000UL) {
    epochBase_ = static_cast<uint32_t>(now);
    epochAtMs_ = millis();
  }
}

uint32_t MqttLink::epoch() const {
  if (epochBase_ == 0) return 0;
  return epochBase_ + (millis() - epochAtMs_) / 1000UL;
}

void MqttLink::localIp(char* buffer, size_t capacity) {
  IPAddress ip = WiFi.localIP();
  snprintf(buffer, capacity, "%u.%u.%u.%u", static_cast<unsigned>(ip[0]), static_cast<unsigned>(ip[1]),
           static_cast<unsigned>(ip[2]), static_cast<unsigned>(ip[3]));
}
