#include "CommandParser.h"

#include <ArduinoJson.h>
#include <string.h>

namespace {
void copyText(char* dst, size_t capacity, const char* src) {
  strncpy(dst, src != nullptr ? src : "", capacity - 1);
  dst[capacity - 1] = '\0';
}

struct NameToType {
  const char* name;
  CommandType type;
};

const NameToType COMMANDS[] = {
    {"ping", CMD_PING}, {"ack", CMD_ACK}, {"evac", CMD_EVAC}, {"stop", CMD_STOP},
    {"interval", CMD_INTERVAL}, {"silent", CMD_SILENT}, {"calibrate", CMD_CALIBRATE}, {"status", CMD_STATUS},
};
}  // namespace

bool parseCommand(const char* json, size_t length, Command& out) {
  memset(&out, 0, sizeof(out));
  JsonDocument doc;
  if (deserializeJson(doc, json, length)) {
    out.type = CMD_INVALID;
    copyText(out.name, sizeof(out.name), "?");
    return false;
  }
  copyText(out.name, sizeof(out.name), doc["cmd"] | "");
  copyText(out.correlationId, sizeof(out.correlationId), doc["cid"] | "");
  copyText(out.alertType, sizeof(out.alertType), doc["type"] | "");
  out.seconds = doc["sec"] | 0;
  out.on = doc["on"] | true;
  out.type = CMD_UNKNOWN;
  for (const NameToType& entry : COMMANDS) {
    if (strcmp(out.name, entry.name) == 0) {
      out.type = entry.type;
      break;
    }
  }
  return out.type != CMD_UNKNOWN;
}
