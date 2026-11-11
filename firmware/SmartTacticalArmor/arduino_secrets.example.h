#pragma once
// Template. Copy to arduino_secrets.h (git-ignored) and fill in real values.
// Never commit or screenshot arduino_secrets.h.

#define SECRET_SSID        "YOUR_WIFI_NAME"        // the UNO R4 WiFi joins 2.4 GHz networks only
#define SECRET_PASS        "YOUR_WIFI_PASSWORD"

// EMQX console -> Access Control -> Authentication (username = DEVICE_ID).
#define SECRET_MQTT_USER   "STA-01"
#define SECRET_MQTT_PASS   "YOUR_MQTT_PASSWORD"

// Optional: pin the broker's root certificate. EMQX Serverless is signed by
// "DigiCert Global Root G2", which the Wi-Fi module already trusts, so this
// is normally not needed. Uncomment only if the TLS connection fails.
// #define SECRET_MQTT_CA_CERT "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"
