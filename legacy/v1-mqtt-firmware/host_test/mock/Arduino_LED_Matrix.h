#pragma once
#include "Arduino.h"
extern const uint32_t* g_frame;
class ArduinoLEDMatrix { public: bool begin() { return true; } void loadFrame(const uint32_t buffer[3]) { g_frame = buffer; } };
