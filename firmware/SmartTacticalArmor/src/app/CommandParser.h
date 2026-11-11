#pragma once
// Parses operations-room commands received on sta/v1/<id>/cmd:
//   {"cmd":"ping","cid":"a1b2c3d4"}
//   {"cmd":"ack","type":"FALL","cid":"..."}     help is coming
//   {"cmd":"evac"} {"cmd":"stop"} {"cmd":"calibrate"} {"cmd":"status"}
//   {"cmd":"interval","sec":5}                  telemetry period 1..60 s
//   {"cmd":"silent","on":true}                  mute / unmute the buzzer
#include <stddef.h>
#include <stdint.h>

enum CommandType : uint8_t {
  CMD_INVALID = 0,  // not JSON
  CMD_UNKNOWN,
  CMD_PING, CMD_ACK, CMD_EVAC, CMD_STOP, CMD_INTERVAL, CMD_SILENT, CMD_CALIBRATE, CMD_STATUS,
};

struct Command {
  CommandType type;
  char name[16];
  char correlationId[17];
  char alertType[24];
  int seconds;
  bool on;
};

bool parseCommand(const char* json, size_t length, Command& out);
