# Legacy — v1 MQTT firmware (archived)

This is the first firmware written for the project (`v1-mqtt-firmware/`), kept unchanged
for reference. It supports the **full** sensor set behind `HAS_*` flags (MAX30102 heart
rate + SpO₂, MAX30205 skin temperature, GPS, Geiger counter, battery) and was verified with
host-side simulations in `host_test/`.

It has been replaced by the modular firmware in [`../firmware`](../firmware), which targets the
hardware available today (Arduino UNO R4 WiFi + MPU-6050) and the cloud broker. The MQTT topics
and JSON payloads are the same, so the backend accepts messages from either firmware — when the
Phase 2–4 sensors are fitted, port the matching sensor code from here into a new module.

`arduino_secrets.h` was renamed to `arduino_secrets.example.h` so that no secrets file is ever
committed; copy it back to `arduino_secrets.h` if you want to build this version.
