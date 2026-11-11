#pragma once
#include "Arduino.h"
#include <limits.h>
struct SimGps { bool fix; double lat, lng, alt; uint32_t sats; };
extern SimGps g_gps;
class TinyGPSPlus {
 public:
  uint32_t chars = 0;
  bool encode(char) { chars++; return false; }
  uint32_t charsProcessed() const { return chars + (g_gps.fix ? 100 : 0); }
  struct Loc { bool isValid() const { return g_gps.fix; } uint32_t age() const { return g_gps.fix ? 200 : ULONG_MAX; } double lat() const { return g_gps.lat; } double lng() const { return g_gps.lng; } } location;
  struct Date { bool isValid() const { return g_gps.fix; } uint16_t year() const { return 2026; } uint8_t month() const { return 11; } uint8_t day() const { return 24; } } date;
  struct Time { bool isValid() const { return g_gps.fix; } uint32_t age() const { return 200; } uint8_t hour() const { return 9; } uint8_t minute() const { return 30; } uint8_t second() const { return (g_ms / 1000) % 60; } } time;
  struct Alt { double meters() const { return g_gps.alt; } } altitude;
  struct Spd { double kmph() const { return 3.4; } } speed;
  struct Hdop { double hdop() const { return 0.9; } } hdop;
  struct Sats { bool isValid() const { return g_gps.fix; } uint32_t value() const { return g_gps.sats; } } satellites;
};
