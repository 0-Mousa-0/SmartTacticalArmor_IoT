#pragma once
// 12x8 frames for the UNO R4 WiFi on-board LED matrix (row-major, MSB first).
#include <stdint.h>

const uint32_t FRAME_OK[3] = {0x00000200, 0x680cc186, 0x303601c0};
const uint32_t FRAME_NOWIFI[3] = {0x20410809, 0x00600600, 0x90108204};
const uint32_t FRAME_WIFI[3] = {0x0001f820, 0x44f21080, 0x60060000};
const uint32_t FRAME_ALERT[3] = {0x06006006, 0x00600600, 0x00060060};
const uint32_t FRAME_SOS[3] = {0x000eee8a, 0x8eae2a2e, 0xee000000};
const uint32_t FRAME_ACK[3] = {0x00072452, 0x85305287, 0x24000000};
const uint32_t FRAME_BLANK[3] = {0x00000000, 0x00000000, 0x00000000};
