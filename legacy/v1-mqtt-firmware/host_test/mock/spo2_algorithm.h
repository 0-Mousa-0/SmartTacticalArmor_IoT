#pragma once
#include "Arduino.h"
#define FreqS 25
#define BUFFER_SIZE (FreqS * 4)
#define MA4_SIZE 4
void maxim_heart_rate_and_oxygen_saturation(uint32_t* ir, int32_t n, uint32_t* red, int32_t* spo2, int8_t* spo2Valid, int32_t* hr, int8_t* hrValid);
