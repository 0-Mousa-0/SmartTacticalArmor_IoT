#pragma once
// MAX30102 FIFO arithmetic, kept free of Arduino.h so it is unit-tested on a PC.
#include <stdint.h>

namespace max30102 {

constexpr uint8_t FIFO_DEPTH = 32;       // samples
constexpr uint8_t BYTES_PER_SAMPLE = 6;  // SpO2 mode: 3 bytes red, then 3 bytes IR

// Samples waiting in the FIFO: write pointer minus read pointer (5-bit
// counters). Equal pointers mean empty, unless samples were lost, which
// only happens when the FIFO is full.
inline uint8_t pendingSamples(uint8_t writePtr, uint8_t readPtr, uint8_t overflowCount) {
  const uint8_t n = static_cast<uint8_t>((writePtr - readPtr) & 0x1F);
  return (n == 0 && (overflowCount & 0x1F) != 0) ? FIFO_DEPTH : n;
}

// One 18-bit ADC reading, most significant byte first. The datasheet keeps
// bit 17 as the top data bit; the 6 bits above it are unused.
inline uint32_t sample18(const uint8_t* bytes) {
  return ((static_cast<uint32_t>(bytes[0]) << 16) | (static_cast<uint32_t>(bytes[1]) << 8) | bytes[2]) & 0x3FFFFUL;
}

}  // namespace max30102
