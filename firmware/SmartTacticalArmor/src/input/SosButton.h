#pragma once
// SOS / "I'm OK" push button (to GND, internal pull-up). Hardware-independent:
// the caller passes the raw pressed state, so the logic is unit-testable.
//   short press  -> BTN_SHORT  ("I'm OK" during a pre-alert, else silence)
//   hold holdMs  -> BTN_LONG   (SOS), fired once while still held
#include <stdint.h>

enum ButtonEvent : uint8_t { BTN_NONE = 0, BTN_SHORT, BTN_LONG };

class SosButton {
 public:
  SosButton(uint32_t debounceMs, uint32_t holdMs)
      : debounceMs_(debounceMs), holdMs_(holdMs), stable_(false), lastRead_(false),
        lastChange_(0), pressStart_(0), longFired_(false) {}

  ButtonEvent update(bool pressed, uint32_t nowMs) {
    if (pressed != lastRead_) {
      lastRead_ = pressed;
      lastChange_ = nowMs;
    }
    ButtonEvent event = BTN_NONE;
    if (nowMs - lastChange_ >= debounceMs_ && pressed != stable_) {
      stable_ = pressed;
      if (pressed) {
        pressStart_ = nowMs;
        longFired_ = false;
      } else if (!longFired_) {
        event = BTN_SHORT;
      }
    }
    if (stable_ && !longFired_ && nowMs - pressStart_ >= holdMs_) {
      longFired_ = true;
      event = BTN_LONG;
    }
    return event;
  }

 private:
  uint32_t debounceMs_, holdMs_;
  bool stable_, lastRead_;
  uint32_t lastChange_, pressStart_;
  bool longFired_;
};
