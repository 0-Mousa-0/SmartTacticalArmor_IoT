#pragma once
// Keep this file out of shared repos / screenshots.

#define SECRET_SSID        "YOUR_WIFI_NAME"
#define SECRET_PASS        "YOUR_WIFI_PASSWORD"

// MQTT credentials. Leave empty for the public test broker (test.mosquitto.org).
// With your own Mosquitto: user = DEVICE_ID (e.g. "STA-01"), created with mosquitto_passwd.
#define SECRET_MQTT_USER   ""
#define SECRET_MQTT_PASS   ""

// Only for MQTT_USE_TLS 1 with a private/self-signed broker certificate.
// Public brokers with a well-known CA usually need nothing here.
// #define SECRET_MQTT_CA_CERT "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"
