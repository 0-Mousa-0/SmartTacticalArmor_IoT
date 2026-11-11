#include "Mpu6050.h"

namespace {
constexpr uint8_t REG_SMPLRT_DIV = 0x19;
constexpr uint8_t REG_CONFIG = 0x1A;
constexpr uint8_t REG_GYRO_CONFIG = 0x1B;
constexpr uint8_t REG_ACCEL_CONFIG = 0x1C;
constexpr uint8_t REG_ACCEL_XOUT_H = 0x3B;
constexpr uint8_t REG_PWR_MGMT_1 = 0x6B;
constexpr uint8_t REG_WHO_AM_I = 0x75;

constexpr float ACCEL_LSB_PER_G = 2048.0f;  // ±16 g: keeps hard impacts in range
constexpr float GYRO_LSB_PER_DPS = 16.4f;   // ±2000 dps

// Big-endian register pair -> signed 16-bit value.
inline int16_t word16(const uint8_t* b, uint8_t i) {
  return static_cast<int16_t>((static_cast<uint16_t>(b[i]) << 8) | b[i + 1]);
}
}  // namespace

bool Mpu6050::begin(TwoWire& wire, uint8_t address) {
  wire_ = &wire;
  address_ = address;
  ok_ = false;
  if (!writeRegister(REG_PWR_MGMT_1, 0x01)) return false;  // wake up, PLL clock
  delay(50);
  who_ = readRegister(REG_WHO_AM_I);
  is6500Family_ = (who_ == 0x70 || who_ == 0x71 || who_ == 0x73);
  writeRegister(REG_SMPLRT_DIV, 0x04);    // 1 kHz / 5 = 200 Hz register update
  writeRegister(REG_CONFIG, 0x01);        // DLPF ~184 Hz: keeps short impact peaks
  writeRegister(REG_GYRO_CONFIG, 0x18);   // ±2000 dps
  writeRegister(REG_ACCEL_CONFIG, 0x18);  // ±16 g
  delay(20);
  ImuSample probe;
  ok_ = read(probe);
  return ok_;
}

bool Mpu6050::read(ImuSample& out) {
  if (wire_ == nullptr) return false;
  wire_->beginTransmission(address_);
  wire_->write(REG_ACCEL_XOUT_H);
  if (wire_->endTransmission(false) != 0) return false;
  if (wire_->requestFrom(address_, static_cast<uint8_t>(14)) != 14) return false;
  uint8_t b[14];
  for (uint8_t i = 0; i < 14; i++) b[i] = static_cast<uint8_t>(wire_->read());

  out.ax = word16(b, 0) / ACCEL_LSB_PER_G;
  out.ay = word16(b, 2) / ACCEL_LSB_PER_G;
  out.az = word16(b, 4) / ACCEL_LSB_PER_G;
  const int16_t rawTemp = word16(b, 6);
  out.gx = word16(b, 8) / GYRO_LSB_PER_DPS;
  out.gy = word16(b, 10) / GYRO_LSB_PER_DPS;
  out.gz = word16(b, 12) / GYRO_LSB_PER_DPS;
  // Datasheet formulas. This is the chip's own temperature: a few °C above
  // the surrounding air (self-heating) — a heat/environment indicator, not body temperature.
  out.tempC = is6500Family_ ? (rawTemp / 333.87f + 21.0f) : (rawTemp / 340.0f + 36.53f);
  return true;
}

const char* Mpu6050::chipName() const {
  switch (who_) {
    case 0x68: return "MPU-6050";
    case 0x70: return "MPU-6500";
    case 0x71: return "MPU-9250";
    case 0x73: return "MPU-9255";
    default: return ok_ ? "MPU-compatible" : "none";
  }
}

void Mpu6050::scan(TwoWire& wire, Print& out) {
  out.print(F("[I2C] devices:"));
  uint8_t found = 0;
  for (uint8_t address = 1; address < 127; address++) {
    wire.beginTransmission(address);
    if (wire.endTransmission() == 0) {
      out.print(F(" 0x"));
      if (address < 16) out.print('0');
      out.print(address, HEX);
      found++;
    }
  }
  if (!found) out.print(F(" none (check SDA/SCL wiring)"));
  out.println();
}

bool Mpu6050::writeRegister(uint8_t reg, uint8_t value) {
  wire_->beginTransmission(address_);
  wire_->write(reg);
  wire_->write(value);
  return wire_->endTransmission() == 0;
}

uint8_t Mpu6050::readRegister(uint8_t reg) {
  wire_->beginTransmission(address_);
  wire_->write(reg);
  if (wire_->endTransmission(false) != 0) return 0xFF;
  if (wire_->requestFrom(address_, static_cast<uint8_t>(1)) != 1) return 0xFF;
  return static_cast<uint8_t>(wire_->read());
}
