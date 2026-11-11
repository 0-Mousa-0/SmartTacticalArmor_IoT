#pragma once
// Store-and-forward buffer: alerts raised while Wi-Fi/MQTT is down are kept
// (newest wins when full) and sent in order after the link comes back.
// Each message keeps its original uptime/epoch, so the backend timestamps the
// event correctly even when it arrives minutes later. Hardware-independent.
#include <stdint.h>

#include "../core/AlertTypes.h"

template <uint8_t CAPACITY>
class AlertOutbox {
 public:
  AlertOutbox() : head_(0), count_(0), dropped_(0) {}

  void push(const AlertMessage& message) {
    if (count_ == CAPACITY) {  // full: drop the oldest
      head_ = (head_ + 1) % CAPACITY;
      count_--;
      dropped_++;
    }
    items_[(head_ + count_) % CAPACITY] = message;
    count_++;
  }

  bool empty() const { return count_ == 0; }
  uint8_t size() const { return count_; }
  uint16_t dropped() const { return dropped_; }
  const AlertMessage& front() const { return items_[head_]; }

  void pop() {
    if (count_ == 0) return;
    head_ = (head_ + 1) % CAPACITY;
    count_--;
  }

 private:
  AlertMessage items_[CAPACITY];
  uint8_t head_, count_;
  uint16_t dropped_;
};
