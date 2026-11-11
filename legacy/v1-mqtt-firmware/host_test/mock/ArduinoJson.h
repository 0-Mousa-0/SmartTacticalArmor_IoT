#pragma once
// Minimal host mock of the ArduinoJson 7 API subset used by the firmware
#include "Arduino.h"
#include <string>
#include <vector>
#include <memory>
#include <cstddef>
struct JNode {
  enum T { NUL, BOOL, INT, UINT, DBL, STR, OBJ } t = NUL;
  bool b = false; long long i = 0; unsigned long long u = 0; double d = 0; std::string s;
  std::vector<std::pair<std::string, std::unique_ptr<JNode>>> obj;
  JNode* get(const std::string& k, bool create) {
    for (auto& kv : obj) if (kv.first == k) return kv.second.get();
    if (!create) return nullptr;
    obj.emplace_back(k, std::unique_ptr<JNode>(new JNode())); return obj.back().second.get();
  }
};
class JsonObject;
class JsonVariant {
 public:
  JNode* n;
  explicit JsonVariant(JNode* p) : n(p) {}
  JsonVariant operator[](const char* k) { if (n->t != JNode::OBJ) { n->obj.clear(); n->t = JNode::OBJ; } return JsonVariant(n->get(k, true)); }
  JsonVariant& operator=(bool v) { n->t = JNode::BOOL; n->b = v; return *this; }
  JsonVariant& operator=(int v) { n->t = JNode::INT; n->i = v; return *this; }
  JsonVariant& operator=(long v) { n->t = JNode::INT; n->i = v; return *this; }
  JsonVariant& operator=(long long v) { n->t = JNode::INT; n->i = v; return *this; }
  JsonVariant& operator=(unsigned v) { n->t = JNode::UINT; n->u = v; return *this; }
  JsonVariant& operator=(unsigned long v) { n->t = JNode::UINT; n->u = v; return *this; }
  JsonVariant& operator=(double v) { n->t = JNode::DBL; n->d = v; return *this; }
  JsonVariant& operator=(float v) { n->t = JNode::DBL; n->d = v; return *this; }
  JsonVariant& operator=(const char* v) { if (!v) { n->t = JNode::NUL; return *this; } n->t = JNode::STR; n->s = v; return *this; }
  JsonVariant& operator=(std::nullptr_t) { n->t = JNode::NUL; return *this; }
  template <class T> T to();
  const char* operator|(const char* def) const { return n && n->t == JNode::STR ? n->s.c_str() : def; }
  int operator|(int def) const { if (!n) return def; if (n->t == JNode::INT) return (int)n->i; if (n->t == JNode::UINT) return (int)n->u; if (n->t == JNode::DBL) return (int)n->d; return def; }
  bool operator|(bool def) const { return n && n->t == JNode::BOOL ? n->b : def; }
};
class JsonObject {
 public:
  JNode* n;
  explicit JsonObject(JNode* p) : n(p) {}
  JsonVariant operator[](const char* k) { return JsonVariant(n->get(k, true)); }
};
template <> inline JsonObject JsonVariant::to<JsonObject>() { n->obj.clear(); n->t = JNode::OBJ; return JsonObject(n); }
class JsonDocument {
 public:
  JNode root;
  JsonDocument() { root.t = JNode::OBJ; }
  JsonVariant operator[](const char* k) { return JsonVariant(root.get(k, true)); }
  JsonVariant operator[](const char* k) const { return JsonVariant(const_cast<JNode&>(root).get(k, false)); }
};
inline void jsonEsc(std::string& o, const std::string& s) { o += '"'; for (char c : s) { if (c == '"' || c == '\\') o += '\\'; o += c; } o += '"'; }
inline void jsonOut(const JNode& n, std::string& o) {
  char b[64];
  switch (n.t) {
    case JNode::NUL: o += "null"; break;
    case JNode::BOOL: o += n.b ? "true" : "false"; break;
    case JNode::INT: snprintf(b, 64, "%lld", n.i); o += b; break;
    case JNode::UINT: snprintf(b, 64, "%llu", n.u); o += b; break;
    case JNode::DBL: { snprintf(b, 64, "%.9f", n.d); std::string s(b); while (!s.empty() && s.back() == '0') s.pop_back(); if (!s.empty() && s.back() == '.') s.pop_back(); o += s; break; }
    case JNode::STR: jsonEsc(o, n.s); break;
    case JNode::OBJ: { o += '{'; bool f = true; for (auto& kv : n.obj) { if (!f) o += ','; f = false; jsonEsc(o, kv.first); o += ':'; jsonOut(*kv.second, o); } o += '}'; break; }
  }
}
extern size_t g_jsonMaxSeen;
inline size_t serializeJson(const JsonDocument& d, char* buf, size_t size) {
  std::string o; jsonOut(d.root, o);
  if (o.size() > g_jsonMaxSeen) g_jsonMaxSeen = o.size();
  if (o.size() >= size) { fprintf(stderr, "!! JSON truncated: %zu >= %zu\n", o.size(), size); }
  size_t n = o.size() < size - 1 ? o.size() : size - 1; memcpy(buf, o.data(), n); buf[n] = 0; return n;
}
class DeserializationError {
 public: int code; explicit DeserializationError(int c) : code(c) {}
  explicit operator bool() const { return code != 0; }
  const char* c_str() const { return code ? "InvalidInput" : "Ok"; }
};
struct JParser {
  const char* p; const char* e;
  void ws() { while (p < e && (*p == ' ' || *p == '\n' || *p == '\t' || *p == '\r')) p++; }
  bool str(std::string& s) { if (p >= e || *p != '"') return false; p++; while (p < e && *p != '"') { if (*p == '\\') p++; s += *p++; } if (p >= e) return false; p++; return true; }
  bool val(JNode& n) {
    ws(); if (p >= e) return false;
    if (*p == '"') { n.t = JNode::STR; return str(n.s); }
    if (*p == '{') { p++; n.t = JNode::OBJ; ws(); if (p < e && *p == '}') { p++; return true; }
      while (true) { ws(); std::string k; if (!str(k)) return false; ws(); if (p >= e || *p != ':') return false; p++; if (!val(*n.get(k, true))) return false; ws(); if (p < e && *p == ',') { p++; continue; } if (p < e && *p == '}') { p++; return true; } return false; } }
    if (!strncmp(p, "true", 4)) { p += 4; n.t = JNode::BOOL; n.b = true; return true; }
    if (!strncmp(p, "false", 5)) { p += 5; n.t = JNode::BOOL; n.b = false; return true; }
    if (!strncmp(p, "null", 4)) { p += 4; n.t = JNode::NUL; return true; }
    char* end; double d = strtod(p, &end); if (end == p) return false; p = end;
    if (d == (long long)d) { n.t = JNode::INT; n.i = (long long)d; } else { n.t = JNode::DBL; n.d = d; } return true;
  }
};
inline DeserializationError deserializeJson(JsonDocument& d, const char* in, size_t len) {
  d.root = JNode(); JParser ps{in, in + len}; bool ok = ps.val(d.root); return DeserializationError(ok && d.root.t == JNode::OBJ ? 0 : 1);
}
