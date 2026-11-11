#pragma once
// ---- Host-side mock of the Arduino API (subset used by the firmware) ----
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include <string>
#include <deque>
typedef uint8_t byte;
typedef bool boolean;
#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define FALLING 2
#define A0 14
#define HEX 16
#define DEC 10
extern uint32_t g_ms;
inline uint32_t millis() { return g_ms; }
inline void delay(uint32_t ms) { g_ms += ms; }
extern int g_pin[32]; extern int g_analog[32]; extern int g_pwm[32];
inline void pinMode(int, int) {}
inline void digitalWrite(int p, int v) { g_pin[p] = v; }
inline int digitalRead(int p) { return g_pin[p]; }
inline void analogWrite(int p, int v) { g_pwm[p] = v; }
inline int analogRead(int p) { return g_analog[p]; }
inline void analogReadResolution(int) {}
inline int digitalPinToInterrupt(int p) { return p; }
extern void (*g_isr)();
inline void attachInterrupt(int, void (*f)(), int) { g_isr = f; }
inline void noInterrupts() {}
inline void interrupts() {}
class __FlashStringHelper;
#define F(s) (reinterpret_cast<const __FlashStringHelper*>(s))
class String {
 public:
  std::string s;
  String() {}
  String(const char* c) : s(c ? c : "") {}
  String(double v, unsigned char d = 2) { char b[40]; snprintf(b, 40, "%.*f", d, v); s = b; }
  const char* c_str() const { return s.c_str(); }
  unsigned int length() const { return s.size(); }
  unsigned char operator<(const String& o) const { return s < o.s; }
};
class Print;
class Printable { public: virtual size_t printTo(Print& p) const = 0; virtual ~Printable() {} };
class Print {
 public:
  virtual size_t write(uint8_t c) = 0;
  virtual size_t write(const uint8_t* b, size_t n) { size_t k = 0; while (n--) k += write(*b++); return k; }
  size_t print(const char* c) { return write((const uint8_t*)c, strlen(c)); }
  size_t print(const __FlashStringHelper* f) { return print((const char*)f); }
  size_t print(const String& s) { return print(s.c_str()); }
  size_t print(char c) { return write((uint8_t)c); }
  size_t print(unsigned char v, int base) { char b[16]; snprintf(b, 16, base == 16 ? "%X" : "%u", v); return print(b); }
  size_t print(int v) { char b[16]; snprintf(b, 16, "%d", v); return print(b); }
  size_t print(unsigned v) { char b[16]; snprintf(b, 16, "%u", v); return print(b); }
  size_t print(long v) { char b[24]; snprintf(b, 24, "%ld", v); return print(b); }
  size_t print(unsigned long v) { char b[24]; snprintf(b, 24, "%lu", v); return print(b); }
  size_t print(double v, int d = 2) { char b[40]; snprintf(b, 40, "%.*f", d, v); return print(b); }
  size_t print(const Printable& p) { return p.printTo(*this); }
  size_t println() { return print("\n"); }
  template <class T> size_t println(const T& v) { size_t n = print(v); return n + println(); }
};
class HardwareSerial : public Print {
 public:
  std::deque<uint8_t> rx; bool quiet = false;
  void begin(unsigned long) {}
  explicit operator bool() const { return true; }
  int available() { return (int)rx.size(); }
  int read() { if (rx.empty()) return -1; int c = rx.front(); rx.pop_front(); return c; }
  size_t write(uint8_t c) override { if (!quiet) fputc(c, stdout); return 1; }
  using Print::write;
};
extern HardwareSerial Serial, Serial1;
class Client : public Print {
 public:
  virtual int connect(const char* host, uint16_t port) = 0;
  virtual int available() = 0; virtual int read() = 0; virtual void stop() = 0;
  virtual uint8_t connected() = 0;
};
