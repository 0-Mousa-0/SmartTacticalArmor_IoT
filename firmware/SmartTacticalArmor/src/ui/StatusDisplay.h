#pragma once
// What the wearer sees on the on-board 12x8 LED matrix, by priority:
//   blinking "!"  pre-alert (press the button if you are OK)
//   overlay       SOS sent / "OK" from the ops room / "connected" (a few seconds)
//   blinking "!"  critical condition
//   "!"           warning condition
//   no-Wi-Fi icon link down          tick: all good
#include <Arduino.h>
#include <Arduino_LED_Matrix.h>

#include "../core/AlertTypes.h"

class StatusDisplay {
 public:
  void begin();
  void showOverlay(const uint32_t* frame, uint32_t durationMs, uint32_t nowMs);
  void update(uint32_t nowMs, bool prealert, Severity highest, bool linkUp);

 private:
  ArduinoLEDMatrix matrix_;
  const uint32_t* shown_ = nullptr;
  const uint32_t* overlay_ = nullptr;
  uint32_t overlayUntil_ = 0;
  bool blink_ = false;
};
