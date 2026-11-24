// Host-side unit tests for the hardware-independent firmware logic.
// Build & run (any C++17 compiler):  ./run_tests.sh   or   run_tests.ps1
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <vector>

#include "src/alerts/AlertManager.h"
#include "src/alerts/AlertOutbox.h"
#include "src/input/SosButton.h"
#include "src/motion/FallDetector.h"
#include "src/motion/MotionAnalyzer.h"
#include "src/sensors/Max30102Fifo.h"
#include "src/vitals/PulseOximeter.h"
#include "src/vitals/VitalsSimulator.h"

static int g_checks = 0, g_failures = 0;
#define CHECK(cond, label)                                                       \
  do {                                                                           \
    g_checks++;                                                                  \
    if (cond) {                                                                  \
      std::printf("  [PASS] %s\n", label);                                       \
    } else {                                                                     \
      g_failures++;                                                              \
      std::printf("  [FAIL] %s  (%s:%d)\n", label, __FILE__, __LINE__);         \
    }                                                                            \
  } while (0)

// Same values as config.h
static const FallDetector::Config FALL_CFG = {0.45f, 60, 2.5f, 1000, 6.0f, 2500, 55.0f};
static const MotionAnalyzer::Config MOTION_CFG = {0.05f, 20.0f, 35.0f, 55.0f};

struct RecordingSink : AlertSink {
  std::vector<AlertMessage> messages;
  void onAlert(const AlertMessage& m) override { messages.push_back(m); }
};

// Feeds a constant |a| and tilt at 100 Hz; returns the first event raised.
static FallEvent feed(FallDetector& d, float accel, float tilt, uint32_t& t, uint32_t durationMs) {
  FallEvent first = FALL_NONE;
  for (uint32_t end = t + durationMs; t < end; t += 10) {
    const FallEvent e = d.update(accel, tilt, t);
    if (first == FALL_NONE && e != FALL_NONE) first = e;
  }
  return first;
}

static void testFallDetector() {
  std::printf("FallDetector\n");
  {
    FallDetector d(FALL_CFG);
    uint32_t t = 1000;
    CHECK(feed(d, 1.0f, 3, t, 500) == FALL_NONE, "standing still: no event");
    CHECK(feed(d, 0.1f, 3, t, 250) == FALL_NONE, "free fall alone is not reported");
    CHECK(feed(d, 3.5f, 3, t, 20) == FALL_NONE, "moderate landing impact (< 6 g): no IMPACT alert");
    CHECK(feed(d, 1.0f, 80, t, 2600) == FALL_SUSPECTED, "free fall + impact + lying = FALL suspected");
    CHECK(d.waiting(), "detector waits for the pre-alert outcome");
    CHECK(feed(d, 0.1f, 80, t, 300) == FALL_NONE, "no new event while waiting");
    d.reset();
    CHECK(!d.waiting(), "reset() returns to idle");
  }
  {
    FallDetector d(FALL_CFG);
    uint32_t t = 1000;
    CHECK(feed(d, 7.5f, 3, t, 10) == FALL_IMPACT, "hard hit (7.5 g) is reported at once as IMPACT");
    CHECK(feed(d, 1.0f, 75, t, 2600) == MAN_DOWN_SUSPECTED, "hard hit + lying = MAN_DOWN suspected");
  }
  {
    FallDetector d(FALL_CFG);
    uint32_t t = 1000;
    feed(d, 0.1f, 3, t, 250);
    CHECK(feed(d, 7.0f, 3, t, 10) == FALL_IMPACT, "free fall ending in a >= 6 g impact also reports IMPACT");
    CHECK(feed(d, 1.0f, 80, t, 2600) == FALL_SUSPECTED, "...but is classified as FALL (free fall came first)");
  }
  {
    FallDetector d(FALL_CFG);
    uint32_t t = 1000;
    feed(d, 7.0f, 3, t, 10);
    CHECK(feed(d, 1.0f, 10, t, 2600) == FALL_NONE && !d.waiting(), "stumble: hit then upright again = no man down");
  }
  {
    FallDetector d(FALL_CFG);
    uint32_t t = 1000;
    feed(d, 0.1f, 3, t, 250);
    CHECK(feed(d, 1.0f, 3, t, 1200) == FALL_NONE, "jump: free fall without impact expires after 1 s");
    CHECK(feed(d, 3.0f, 80, t, 20) == FALL_NONE && feed(d, 1.0f, 80, t, 2600) == FALL_NONE,
          "a later 3 g bump on its own is not a fall");
  }
}

static void run(MotionAnalyzer& m, const ImuSample& s, uint32_t& t, uint32_t durationMs) {
  for (uint32_t end = t + durationMs; t < end; t += 10) m.update(s, t);
}

static void testMotionAnalyzer() {
  std::printf("MotionAnalyzer\n");
  MotionAnalyzer m(MOTION_CFG);
  uint32_t t = 0;
  m.setReference(0, 0, 1, t);
  run(m, {0, 0, 1, 0, 0, 0, 31.0f}, t, 2000);
  CHECK(m.tiltDeg() < 2 && m.posture() == POSTURE_UPRIGHT, "upright: tilt ~0, posture upright");
  run(m, {0.7071f, 0, 0.7071f, 0, 0, 0, 31.0f}, t, 2000);
  CHECK(std::fabs(m.tiltDeg() - 45) < 3 && m.posture() == POSTURE_BENT, "45 deg: posture bent");
  run(m, {1, 0, 0, 0, 0, 0, 31.0f}, t, 2000);
  CHECK(std::fabs(m.tiltDeg() - 90) < 3 && m.posture() == POSTURE_LYING, "90 deg: posture lying");
  CHECK(std::fabs(m.temperatureC() - 31.0f) < 0.01f, "die temperature reported");
  // Changing posture is movement; then 5 s without motion must count as still.
  run(m, {1, 0, 0, 0, 0, 0, 31.0f}, t, 5000);
  CHECK(m.stillMs(t) >= 3000, "no motion after the posture change: still time grows");
  m.update({0, 0, 1, 80, 0, 0, 31.0f}, t);  // rotating at 80 deg/s
  CHECK(m.stillMs(t) == 0, "rotation resets the still timer");
  m.takePeak();
  m.update({0, 0, 3.2f, 0, 0, 0, 31.0f}, t += 10);
  CHECK(std::fabs(m.takePeak() - 3.2f) < 0.01f, "peak |a| since last report");
  CHECK(m.takePeak() == 0, "peak resets after it is reported");
  // Calibration happens while the wearer stands still: let the gravity estimate settle first.
  run(m, {1, 0, 0, 0, 0, 0, 31.0f}, t, 2000);
  m.requestRecalibration();
  run(m, {1, 0, 0, 0, 0, 0, 31.0f}, t, 2000);
  CHECK(m.tiltDeg() < 3 && m.posture() == POSTURE_UPRIGHT, "calibrate: current pose becomes the upright reference");
}

static void testAlertManager() {
  std::printf("AlertManager\n");
  RecordingSink sink;
  AlertManager a(sink, 30000, 10000);
  a.setContext({100, 0, 5.0f, 31.0f, true, false, 0.0f, false, 0.0f});

  CHECK(a.condition(AL_VEST_TEMP_HIGH, true, SEV_WARNING, 47, 5000, 1000) == CC_NONE, "condition must persist before alerting");
  CHECK(a.condition(AL_VEST_TEMP_HIGH, true, SEV_WARNING, 47, 5000, 6100) == CC_RAISED, "raised after the persistence time");
  CHECK(sink.messages.back().state == ST_ACTIVE && sink.messages.back().severity == SEV_WARNING, "sent as active/warning");
  CHECK(a.activeMask() == (1UL << AL_VEST_TEMP_HIGH), "telemetry mask bit 15 set");
  CHECK(a.condition(AL_VEST_TEMP_HIGH, true, SEV_CRITICAL, 56, 5000, 7100) == CC_ESCALATED, "escalates to critical");
  CHECK(a.highestActive() == SEV_CRITICAL, "highest active severity tracked");
  CHECK(a.condition(AL_VEST_TEMP_HIGH, true, SEV_CRITICAL, 56, 5000, 20000) == CC_NONE, "no spam between reminders");
  CHECK(a.condition(AL_VEST_TEMP_HIGH, true, SEV_CRITICAL, 56, 5000, 37200) == CC_REMINDER, "30 s reminder while active");
  CHECK(a.condition(AL_VEST_TEMP_HIGH, false, SEV_NONE, 40, 5000, 38000) == CC_CLEARED, "cleared when it ends");
  CHECK(sink.messages.back().state == ST_CLEARED && a.activeMask() == 0, "cleared message sent, mask empty");

  CHECK(a.startPrealert(AL_FALL, 3.4f, 50000), "pre-alert starts");
  CHECK(sink.messages.back().state == ST_PENDING && sink.messages.back().severity == SEV_INFO, "pending/info heads-up sent");
  CHECK((a.activeMask() & (1UL << AL_FALL)) != 0, "pre-alert shows in the mask");
  CHECK(!a.startPrealert(AL_MAN_DOWN, 7, 50001), "only one pre-alert at a time");
  CHECK(a.updatePrealert(false, 55000) == PA_NONE, "still waiting at 5 s");
  CHECK(a.updatePrealert(true, 56000) == PA_CANCELLED && sink.messages.back().state == ST_CANCELLED, "wearer pressed I'm OK -> cancelled");

  a.startPrealert(AL_FALL, 3.4f, 60000);
  CHECK(a.updatePrealert(false, 70000) == PA_ESCALATED, "no answer in 10 s -> escalated");
  CHECK(sink.messages.back().state == ST_EVENT && sink.messages.back().severity == SEV_CRITICAL, "escalation is a critical event");

  a.startPrealert(AL_MAN_DOWN, 8, 80000);
  CHECK(a.escalatePrealert() && sink.messages.back().type == AL_MAN_DOWN, "SOS during a pre-alert escalates it at once");

  bool increasing = true;
  for (size_t i = 1; i < sink.messages.size(); i++) increasing &= sink.messages[i].seq > sink.messages[i - 1].seq;
  CHECK(increasing, "sequence numbers increase (backend de-duplicates on them)");
  CHECK(sink.messages.front().uptimeS == 100 && sink.messages.front().tiltDeg == 5.0f, "context snapshot attached");
}

static void testOutboxAndButton() {
  std::printf("AlertOutbox / SosButton\n");
  AlertOutbox<3> box;
  for (uint16_t i = 1; i <= 4; i++) {
    AlertMessage m = {};
    m.seq = i;
    box.push(m);
  }
  CHECK(box.size() == 3 && box.dropped() == 1 && box.front().seq == 2, "full outbox drops the oldest alert");
  box.pop();
  CHECK(box.front().seq == 3, "alerts leave in order");

  SosButton b(30, 2000);
  uint32_t t = 0;
  ButtonEvent e = BTN_NONE;
  for (; t < 10; t++) e = b.update(true, t);
  for (; t < 100; t++) e = b.update(false, t) != BTN_NONE ? BTN_SHORT : e;
  CHECK(e == BTN_NONE, "10 ms contact bounce is ignored");
  ButtonEvent seen = BTN_NONE;
  for (uint32_t end = t + 150; t < end; t++) seen = b.update(true, t) != BTN_NONE ? BTN_LONG : seen;
  for (uint32_t end = t + 100; t < end; t++) {
    const ButtonEvent ev = b.update(false, t);
    if (ev != BTN_NONE) seen = ev;
  }
  CHECK(seen == BTN_SHORT, "150 ms press = short (I'm OK)");
  int longs = 0, shorts = 0;
  for (uint32_t end = t + 2500; t < end; t++) longs += b.update(true, t) == BTN_LONG;
  for (uint32_t end = t + 100; t < end; t++) shorts += b.update(false, t) == BTN_SHORT;
  CHECK(longs == 1 && shorts == 0, "2 s hold = one SOS, no short press on release");
}

// ── MAX30102 + pulse oximetry ──────────────────────────────────────────
// Synthetic PPG at 50 samples/s: each heartbeat lowers the reflected light
// (a sharp systolic dip plus a smaller dicrotic wave). The red pulse is
// `ratio` times the IR pulse relative to its level, so the expected SpO2 is
// Maxim's curve at that ratio (0.6 -> 96.8 %, 0.8 -> 90.3 %).
struct PpgSim {
  float bpm = 72.0f;
  float ratio = 0.6f;
  float perfusion = 0.02f;  // IR pulse = 2 % of the IR level
  float dcIr = 120000.0f, dcRed = 100000.0f;
  float noise = 0.0f;       // uniform noise, fraction of the level
  float drift = 0.0f;       // breathing drift (0.25 Hz), fraction of the level
  uint32_t n = 0;
  uint32_t seed = 12345;

  float random() {  // -0.5 .. 0.5
    seed = seed * 1103515245u + 12345u;
    return static_cast<float>((seed >> 8) & 0xFFFF) / 65535.0f - 0.5f;
  }
  static float shape(float phase) {
    const float a = (phase - 0.18f) / 0.07f, b = (phase - 0.45f) / 0.09f;
    return std::exp(-a * a) + 0.35f * std::exp(-b * b);
  }
  void next(uint32_t& red, uint32_t& ir) {
    const float t = static_cast<float>(n++) / 50.0f;
    const float beat = shape(std::fmod(t * bpm / 60.0f, 1.0f));
    const float level = 1.0f + drift * std::sin(2.0f * 3.14159265f * 0.25f * t);
    ir = static_cast<uint32_t>(dcIr * level * (1.0f - perfusion * beat) + noise * dcIr * random());
    red = static_cast<uint32_t>(dcRed * level * (1.0f - perfusion * ratio * beat) + noise * dcRed * random());
  }
};

static void feedPpg(PulseOximeter& ox, PpgSim& sim, float seconds) {
  for (int k = 0; k < static_cast<int>(seconds * 50.0f); k++) {
    uint32_t red, ir;
    sim.next(red, ir);
    ox.addSample(red, ir);
  }
}

static void feedNoFinger(PulseOximeter& ox, float seconds) {
  for (int k = 0; k < static_cast<int>(seconds * 50.0f); k++) ox.addSample(1500 + (k % 7) * 40, 2500 + (k % 5) * 60);
}

static bool near(float value, float expected, float tolerance) { return std::fabs(value - expected) <= tolerance; }

static void testPulseOximeter() {
  std::printf("Max30102 FIFO / PulseOximeter\n");
  const uint8_t bytes[3] = {0xFF, 0x12, 0x34};
  CHECK(max30102::sample18(bytes) == 0x31234, "18-bit sample keeps bits 17..0 only");
  CHECK(max30102::pendingSamples(5, 2, 0) == 3, "3 samples waiting");
  CHECK(max30102::pendingSamples(1, 30, 0) == 3, "pointer wrap-around (30 -> 1)");
  CHECK(max30102::pendingSamples(7, 7, 0) == 0 && max30102::pendingSamples(7, 7, 4) == 32,
        "equal pointers: empty, or full after an overflow");

  const PulseOximeter::Config cfg = {50.0f, 50000};
  {
    PulseOximeter ox(cfg);
    feedNoFinger(ox, 10);
    CHECK(!ox.contact() && !ox.hasHeartRate() && !ox.hasSpo2(), "nothing on the sensor: no contact, no readings");
  }
  {
    PulseOximeter ox(cfg);
    PpgSim sim;
    feedPpg(ox, sim, 3);
    CHECK(ox.contact() && !ox.hasHeartRate(), "finger placed: contact at once, heart rate only after a few beats");
    feedPpg(ox, sim, 17);
    std::printf("         72 bpm / R 0.6 -> %.1f bpm, SpO2 %.1f %%\n", ox.heartRate(), ox.spo2());
    CHECK(ox.hasHeartRate() && near(ox.heartRate(), 72.0f, 2.0f), "72 bpm measured within 2 bpm");
    CHECK(ox.hasSpo2() && near(ox.spo2(), 96.8f, 1.5f), "SpO2 96.8 % (R = 0.6) within 1.5 %");
    bool beat = ox.takeBeat();
    CHECK(beat && !ox.takeBeat(), "takeBeat() reports each beat once");

    feedNoFinger(ox, 1);
    CHECK(!ox.contact() && !ox.hasHeartRate() && !ox.hasSpo2(), "finger removed: readings cleared within 1 s");
  }
  {
    PulseOximeter ox(cfg);
    PpgSim sim;
    sim.bpm = 120.0f;
    sim.ratio = 0.8f;
    feedPpg(ox, sim, 20);
    std::printf("         120 bpm / R 0.8 -> %.1f bpm, SpO2 %.1f %%\n", ox.heartRate(), ox.spo2());
    CHECK(near(ox.heartRate(), 120.0f, 3.0f), "120 bpm (exertion) within 3 bpm");
    CHECK(near(ox.spo2(), 90.3f, 2.0f), "low oxygen (90.3 %, R = 0.8) within 2 %");
  }
  {
    PulseOximeter ox(cfg);
    PpgSim sim;
    sim.bpm = 45.0f;
    feedPpg(ox, sim, 25);
    std::printf("         45 bpm -> %.1f bpm\n", ox.heartRate());
    CHECK(near(ox.heartRate(), 45.0f, 2.0f), "slow pulse (45 bpm) within 2 bpm, dicrotic wave not counted");
  }
  {
    PulseOximeter ox(cfg);
    PpgSim sim;
    sim.bpm = 84.0f;
    sim.noise = 0.0015f;   // sensor noise
    sim.drift = 0.004f;    // breathing: 20 % of the pulse size
    feedPpg(ox, sim, 25);
    std::printf("         84 bpm + noise + breathing -> %.1f bpm, SpO2 %.1f %%\n", ox.heartRate(), ox.spo2());
    CHECK(near(ox.heartRate(), 84.0f, 3.0f), "noise and breathing drift: still within 3 bpm");
    CHECK(near(ox.spo2(), 96.8f, 2.5f), "noise and breathing drift: SpO2 within 2.5 %");
  }
  {
    PulseOximeter ox(cfg);
    PpgSim sim;
    feedPpg(ox, sim, 15);
    ox.markGap();
    sim.n += 40;  // 0.8 s of samples lost (FIFO overflow during a Wi-Fi reconnect)
    feedPpg(ox, sim, 5);
    CHECK(near(ox.heartRate(), 72.0f, 2.0f), "lost samples do not create a false beat interval");
  }
}

// Runs the simulator at 1 Hz; returns the largest change between two seconds.
static int runSim(VitalsSimulator& sim, uint32_t& t, int seconds, float activity, bool lying, int& minHr, int& maxHr,
                  int& minSpo2, int& maxSpo2) {
  int previous = sim.started() ? sim.heartRate() : -1, biggestStep = 0;
  minHr = minSpo2 = 1000;
  maxHr = maxSpo2 = 0;
  for (int k = 0; k < seconds; k++, t += 1000) {
    sim.update(t, activity, lying);
    const int hr = sim.heartRate(), spo2 = sim.spo2();
    if (previous >= 0 && std::abs(hr - previous) > biggestStep) biggestStep = std::abs(hr - previous);
    previous = hr;
    if (hr < minHr) minHr = hr;
    if (hr > maxHr) maxHr = hr;
    if (spo2 < minSpo2) minSpo2 = spo2;
    if (spo2 > maxSpo2) maxSpo2 = spo2;
  }
  return biggestStep;
}

static void testVitalsSimulator() {
  std::printf("VitalsSimulator (demo values without a MAX30102)\n");
  VitalsSimulator sim(72.0f, 2026);
  uint32_t t = 5000;
  int lo, hi, sLo, sHi;
  int step = runSim(sim, t, 120, 0.01f, false, lo, hi, sLo, sHi);
  std::printf("         rest: %d-%d bpm, SpO2 %d-%d %%\n", lo, hi, sLo, sHi);
  CHECK(lo >= 66 && hi <= 79, "at rest: 66-79 bpm");
  CHECK(sLo >= 96 && sHi <= 99, "at rest: SpO2 96-99 %");

  runSim(sim, t, 5, 0.6f, false, lo, hi, sLo, sHi);
  CHECK(hi < 100, "effort starts: no sudden jump (still under 100 bpm after 5 s)");
  step = std::max(step, runSim(sim, t, 115, 0.6f, false, lo, hi, sLo, sHi));
  std::printf("         after 2 min of hard effort: %d bpm, SpO2 %d %%\n", sim.heartRate(), sim.spo2());
  CHECK(sim.heartRate() >= 125 && sim.heartRate() <= 150, "hard effort: heart rate climbs to 125-150 bpm");
  CHECK(sLo >= 96 && sHi <= 99, "hard effort: SpO2 stays 96-99 %");

  step = std::max(step, runSim(sim, t, 30, 0.01f, false, lo, hi, sLo, sHi));
  CHECK(sim.heartRate() > 95, "recovery is gradual (still above 95 bpm after 30 s)");
  step = std::max(step, runSim(sim, t, 180, 0.01f, false, lo, hi, sLo, sHi));
  std::printf("         3.5 min after the effort: %d bpm\n", sim.heartRate());
  CHECK(sim.heartRate() <= 80, "back near rest within a few minutes");

  step = std::max(step, runSim(sim, t, 90, 0.01f, true, lo, hi, sLo, sHi));  // settling down
  step = std::max(step, runSim(sim, t, 60, 0.01f, true, lo, hi, sLo, sHi));
  std::printf("         lying still: %d-%d bpm\n", lo, hi);
  CHECK(hi <= 72, "lying still: a little lower than standing");
  CHECK(step <= 6, "never jumps more than 6 bpm from one second to the next");
}

int main() {
  testFallDetector();
  testMotionAnalyzer();
  testAlertManager();
  testOutboxAndButton();
  testPulseOximeter();
  testVitalsSimulator();
  std::printf("\n%d checks, %d failed: %s\n", g_checks, g_failures, g_failures ? "SOME TESTS FAILED" : "ALL TESTS PASSED");
  return g_failures ? 1 : 0;
}
