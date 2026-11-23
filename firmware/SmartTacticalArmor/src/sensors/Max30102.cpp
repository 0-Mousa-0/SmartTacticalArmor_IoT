#include "Max30102.h"

#include "Max30102Fifo.h"

namespace {
constexpr uint8_t ADDRESS = 0x57;  // fixed on every MAX30102 module
constexpr uint8_t PART_ID = 0x15;  // MAX30102 and MAX30105

constexpr uint8_t REG_INTR_ENABLE_1 = 0x02;
constexpr uint8_t REG_INTR_ENABLE_2 = 0x03;
constexpr uint8_t REG_FIFO_WR_PTR = 0x04;
constexpr uint8_t REG_OVF_COUNTER = 0x05;
constexpr uint8_t REG_FIFO_RD_PTR = 0x06;
constexpr uint8_t REG_FIFO_DATA = 0x07;
constexpr uint8_t REG_FIFO_CONFIG = 0x08;
constexpr uint8_t REG_MODE_CONFIG = 0x09;
constexpr uint8_t REG_SPO2_CONFIG = 0x0A;
constexpr uint8_t REG_LED1_PA = 0x0C;  // red
constexpr uint8_t REG_LED2_PA = 0x0D;  // infrared
constexpr uint8_t REG_PART_ID = 0xFF;

constexpr uint8_t MODE_RESET = 0x40;
constexpr uint8_t MODE_SPO2 = 0x03;                    // red + IR
constexpr uint8_t FIFO_AVERAGE_4 = 0x40;               // SMP_AVE = 4
constexpr uint8_t FIFO_ROLLOVER = 0x10;
constexpr uint8_t SPO2_RANGE_4096NA = 0x20;
constexpr uint8_t SPO2_RATE_200 = 0x08;                // 200 sps / 4 = 50 samples/s
constexpr uint8_t SPO2_PULSE_411US = 0x03;             // 18-bit
constexpr uint8_t SAMPLES_PER_READ = 5;                // 30 bytes: fits the 32-byte Wire buffer
}  // namespace

bool Max30102::begin(TwoWire& wire, uint8_t ledCurrent) {
  wire_ = &wire;
  ok_ = false;
  uint8_t part = 0;
  if (!readRegister(REG_PART_ID, part) || part != PART_ID) return false;

  writeRegister(REG_MODE_CONFIG, MODE_RESET);
  for (uint8_t i = 0; i < 20; i++) {  // the reset bit clears itself within a few ms
    delay(5);
    uint8_t mode = MODE_RESET;
    if (readRegister(REG_MODE_CONFIG, mode) && (mode & MODE_RESET) == 0) break;
  }
  writeRegister(REG_INTR_ENABLE_1, 0x00);  // polled: the INT pin is not used
  writeRegister(REG_INTR_ENABLE_2, 0x00);
  writeRegister(REG_FIFO_CONFIG, FIFO_AVERAGE_4 | FIFO_ROLLOVER | 0x0F);
  writeRegister(REG_SPO2_CONFIG, SPO2_RANGE_4096NA | SPO2_RATE_200 | SPO2_PULSE_411US);
  writeRegister(REG_LED1_PA, ledCurrent);
  writeRegister(REG_LED2_PA, ledCurrent);
  writeRegister(REG_FIFO_WR_PTR, 0);
  writeRegister(REG_OVF_COUNTER, 0);
  writeRegister(REG_FIFO_RD_PTR, 0);
  ok_ = writeRegister(REG_MODE_CONFIG, MODE_SPO2);
  return ok_;
}

uint8_t Max30102::read(PpgSample* out, uint8_t maxSamples, uint8_t& lost) {
  lost = 0;
  if (!ok_) return 0;
  uint8_t writePtr = 0, overflow = 0, readPtr = 0;
  if (!readRegister(REG_FIFO_WR_PTR, writePtr) || !readRegister(REG_OVF_COUNTER, overflow) ||
      !readRegister(REG_FIFO_RD_PTR, readPtr)) {
    return 0;
  }
  lost = overflow & 0x1F;  // the chip clears it once a sample is read
  uint8_t wanted = max30102::pendingSamples(writePtr, readPtr, overflow);
  if (wanted > maxSamples) wanted = maxSamples;

  uint8_t got = 0;
  while (got < wanted) {
    uint8_t chunk = wanted - got;
    if (chunk > SAMPLES_PER_READ) chunk = SAMPLES_PER_READ;
    wire_->beginTransmission(ADDRESS);
    wire_->write(REG_FIFO_DATA);  // reading this register pops samples; the address does not advance
    if (wire_->endTransmission(false) != 0) break;
    const uint8_t bytes = chunk * max30102::BYTES_PER_SAMPLE;
    if (wire_->requestFrom(ADDRESS, bytes) != bytes) break;
    for (uint8_t i = 0; i < chunk; i++) {
      uint8_t raw[max30102::BYTES_PER_SAMPLE];
      for (uint8_t b = 0; b < max30102::BYTES_PER_SAMPLE; b++) raw[b] = static_cast<uint8_t>(wire_->read());
      out[got].red = max30102::sample18(raw);
      out[got].ir = max30102::sample18(raw + 3);
      got++;
    }
  }
  return got;
}

bool Max30102::writeRegister(uint8_t reg, uint8_t value) {
  wire_->beginTransmission(ADDRESS);
  wire_->write(reg);
  wire_->write(value);
  return wire_->endTransmission() == 0;
}

bool Max30102::readRegister(uint8_t reg, uint8_t& value) {
  wire_->beginTransmission(ADDRESS);
  wire_->write(reg);
  if (wire_->endTransmission(false) != 0) return false;
  if (wire_->requestFrom(ADDRESS, static_cast<uint8_t>(1)) != 1) return false;
  value = static_cast<uint8_t>(wire_->read());
  return true;
}
