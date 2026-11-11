#include "StatusDisplay.h"

#include "MatrixFrames.h"

void StatusDisplay::begin() {
  matrix_.begin();
  matrix_.loadFrame(FRAME_WIFI);
  shown_ = FRAME_WIFI;
}

void StatusDisplay::showOverlay(const uint32_t* frame, uint32_t durationMs, uint32_t nowMs) {
  overlay_ = frame;
  overlayUntil_ = nowMs + durationMs;
}

void StatusDisplay::update(uint32_t nowMs, bool prealert, Severity highest, bool linkUp) {
  blink_ = !blink_;
  const uint32_t* frame;
  if (prealert) {
    frame = blink_ ? FRAME_ALERT : FRAME_BLANK;
  } else if (overlay_ != nullptr && static_cast<int32_t>(overlayUntil_ - nowMs) > 0) {
    frame = overlay_;
  } else if (highest == SEV_CRITICAL) {
    frame = blink_ ? FRAME_ALERT : FRAME_BLANK;
  } else if (highest == SEV_WARNING) {
    frame = FRAME_ALERT;
  } else if (!linkUp) {
    frame = FRAME_NOWIFI;
  } else {
    frame = FRAME_OK;
  }
  if (frame != shown_) {
    matrix_.loadFrame(frame);
    shown_ = frame;
  }
}
