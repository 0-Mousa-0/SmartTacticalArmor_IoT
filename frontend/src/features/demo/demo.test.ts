import { describe, expect, it } from 'vitest';
import { DemoWorld } from './domain/DemoWorld';
import { assessRisk, computePriority, emptyBaseline, evaluateMetric, METRIC_SPECS, pyRound } from './domain/models';
import { BUILT_IN_ROSTER } from './domain/roster';
import { CYCLE_S } from './domain/scenario';

const START = Date.parse('2026-11-24T05:15:00Z'); // 08:15 in Riyadh
const at = (seconds: number) => START + seconds * 1000;
const world = (seed = 7) => new DemoWorld({ roster: BUILT_IN_ROSTER, start: START, seed });
const id = (slot: number) => BUILT_IN_ROSTER[slot].deviceId;
const since = (iso: string) => Date.parse(iso) >= START;

describe('simulation: the server models, ported', () => {
  it('rounds halves to even, like Python', () => {
    expect([pyRound(2.5), pyRound(3.5), pyRound(4.4), pyRound(4.6)]).toEqual([2, 4, 4, 5]);
  });

  it('prioritises alerts like the server', () => {
    expect(computePriority('SOS', 'critical', 'open')).toBe(100);
    expect(computePriority('FALL', 'critical', 'acknowledged')).toBe(54);
    expect(computePriority('HR_ANOMALY', 'warning', 'open', 300)).toBe(48); // 55 x 0.7 + age boost 10 = 48.4999…
  });

  it('scores risk like the server', () => {
    const fallen = assessRisk({
      openAlerts: [{ type: 'FALL', severity: 'critical', status: 'open' }],
      connected: true,
      hasTelemetry: true,
      prealert: false,
      posture: 'lying',
      stillS: 75,
      vestTempC: 31,
      anomalousMetrics: ['heart_rate'],
    });
    expect(fallen.score).toBe(100);
    expect(fallen.level).toBe('critical');
    expect(fallen.factors.map((factor) => factor.code)).toEqual(['alert:FALL', 'posture:lying', 'immobile', 'anomaly:heart_rate']);

    const lost = assessRisk({
      openAlerts: [{ type: 'CONTACT_LOST', severity: 'warning', status: 'open' }],
      connected: false,
      hasTelemetry: true,
      prealert: false,
      posture: 'upright',
      stillS: 0,
      vestTempC: 24,
      anomalousMetrics: [],
    });
    expect([lost.score, lost.level]).toEqual([72, 'high']);
  });

  it('only flags a shift after the warm-up, against the personal baseline', () => {
    const spec = METRIC_SPECS.find((s) => s.metric === 'heart_rate')!;
    const baseline = emptyBaseline();
    for (let i = 0; i < 30; i += 1) expect(evaluateMetric(spec, 80 + (i % 3), baseline).isAnomaly).toBe(false);
    expect(evaluateMetric(spec, 81, baseline).isAnomaly).toBe(false);
    expect(evaluateMetric(spec, 140, baseline).isAnomaly).toBe(true);
    expect(baseline.consecutive).toBe(1);
  });
});

describe('simulation: the world', () => {
  it('opens on six units on duty with believable readings', () => {
    const units = world().listUnits();
    expect(units.map((unit) => unit.wearer?.callsign)).toEqual(['ALPHA-01', 'ALPHA-02', 'ALPHA-03', 'ALPHA-04', 'ALPHA-05', 'ALPHA-06']);
    for (const unit of units) {
      const t = unit.telemetry!;
      expect(unit.connection).toBe('online');
      expect(unit.isSimulated).toBe(true);
      expect(unit.sensors.ppg).toBe('simulated');
      expect(unit.position?.source).toBe('post');
      expect(t.heartRate).toBeGreaterThanOrEqual(55);
      expect(t.heartRate).toBeLessThanOrEqual(115);
      expect(t.spo2).toBeGreaterThanOrEqual(95);
      expect(t.vestTempC).toBeGreaterThan(15);
      expect(t.vestTempC).toBeLessThan(40);
      expect(unit.risk.level).toBe('normal');
    }
    expect(units[0].position).toMatchObject({ lat: 24.75316823074473, lng: 46.72672938465661 });
  });

  it('keeps six hours of history for the charts', () => {
    const w = world();
    expect(w.history(id(0), 360)).toHaveLength(720);
    const recent = w.history(id(0), 15)!;
    expect(recent.length).toBeGreaterThan(80);
    expect(recent.every((point) => Date.parse(point.t) >= START - 15 * 60_000)).toBe(true);
  });

  it('has no false alarms on a routine day', () => {
    // Before the storyline starts only four scripted incidents happen (ALPHA-03..06);
    // ALPHA-01 and ALPHA-02 just do their routine for six hours.
    for (const seed of [1, 2, 3, 4, 5]) {
      const quiet = world(seed)
        .listAlerts({ scope: 'all', limit: 200 })
        .items.filter((alert) => ['ALPHA-01', 'ALPHA-02'].includes(alert.wearer?.callsign ?? ''));
      expect(quiet).toEqual([]);
    }
  });

  it('plays every incident of the storyline in one cycle', () => {
    const w = world();
    w.advanceTo(at(CYCLE_S));
    const types = new Set(w.listAlerts({ scope: 'all', limit: 200 }).items.filter((alert) => since(alert.occurredAt)).map((alert) => alert.type));
    for (const type of ['HR_HIGH', 'HR_ANOMALY', 'ACTIVITY_ANOMALY', 'FALL', 'NO_MOTION', 'VEST_TEMP_HIGH', 'SPO2_LOW', 'SPO2_ANOMALY', 'TEMP_ANOMALY', 'IMPACT', 'SOS', 'CONTACT_LOST']) {
      expect(types).toContain(type);
    }
  });

  it('escalates a fall nobody answers, and lets a stumble be cancelled', () => {
    const w = world();
    w.advanceTo(at(100));
    const fall = w.listAlerts({ scope: 'open', deviceId: id(3) }).items.find((alert) => alert.type === 'FALL')!;
    expect([fall.severity, fall.status]).toEqual(['critical', 'open']);
    expect(w.getAlert(fall.id)!.events.map((event) => event.kind)).toEqual(['pending', 'escalated']);
    const fallen = w.getUnit(id(3))!;
    expect(fallen.telemetry!.posture).toBe('lying');
    expect(fallen.risk.level).toBe('critical');

    w.advanceTo(at(610));
    const stumble = w.listAlerts({ scope: 'closed', deviceId: id(0) }).items.find((alert) => alert.type === 'FALL' && since(alert.occurredAt))!;
    expect(stumble.status).toBe('cancelled');
  });

  it('sends the heart rate above 160 in the pursuit and brings it back without a second AI alarm', () => {
    const w = world();
    w.advanceTo(at(80));
    expect(w.getUnit(id(2))!.telemetry!.heartRate).toBeGreaterThanOrEqual(160);
    w.advanceTo(at(CYCLE_S - 20));
    expect(w.getUnit(id(2))!.telemetry!.heartRate).toBeLessThan(120);
    const anomalies = w.listAlerts({ scope: 'all', deviceId: id(2), limit: 200 }).items.filter((alert) => alert.type === 'HR_ANOMALY' && since(alert.occurredAt));
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].status).toBe('cleared');
  });

  it('moves vital signs like a body, never in jumps', () => {
    const w = world();
    w.advanceTo(at(CYCLE_S));
    for (let slot = 0; slot < BUILT_IN_ROSTER.length; slot += 1) {
      const points = w.history(id(slot), 13)!.filter((point) => since(point.t));
      for (let i = 1; i < points.length; i += 1) {
        expect(Math.abs(points[i].heartRate! - points[i - 1].heartRate!)).toBeLessThanOrEqual(30);
        expect(points[i].spo2!).toBeGreaterThanOrEqual(85);
        expect(points[i].vestTempC!).toBeLessThan(55);
      }
    }
  });

  it('loses contact with a vest and gets it back', () => {
    const w = world();
    w.advanceTo(at(490));
    expect(w.getUnit(id(5))!.connection).toBe('offline');
    expect(w.listAlerts({ scope: 'open', deviceId: id(5) }).items.map((alert) => alert.type)).toContain('CONTACT_LOST');
    w.advanceTo(at(560));
    expect(w.getUnit(id(5))!.connection).toBe('online');
    expect(w.listAlerts({ scope: 'open', deviceId: id(5) }).items.map((alert) => alert.type)).not.toContain('CONTACT_LOST');
  });

  it('lets the operator acknowledge and resolve, and tells the vest', () => {
    const w = world();
    w.advanceTo(at(100));
    const fall = w.listAlerts({ scope: 'open', deviceId: id(3) }).items.find((alert) => alert.type === 'FALL')!;
    const ack = w.acknowledge(fall.id, 'Team on the way');
    expect(ack).toMatchObject({ ok: true, deviceNotified: true, alert: { status: 'acknowledged' } });
    w.advanceTo(at(103));
    expect(w.commands(id(3))![0]).toMatchObject({ type: 'ack', status: 'acknowledged', responseInfo: 'FALL' });
    expect(w.resolve(fall.id, 'Evacuated')).toMatchObject({ ok: true, alert: { status: 'resolved', resolutionNote: 'Evacuated' } });
    expect(w.resolve(fall.id)).toEqual({ ok: false, reason: 'closed' });
    expect(w.acknowledge('nope')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('answers commands like the vest firmware', () => {
    const w = world();
    w.sendCommand(id(0), 'interval', { sec: 2 });
    w.sendCommand(id(0), 'silent', { on: true });
    w.sendCommand(id(0), 'interval', { sec: 99 });
    w.advanceTo(at(5));
    const [badInterval, silent, interval] = w.commands(id(0))!;
    expect(interval).toMatchObject({ type: 'interval', status: 'acknowledged' });
    expect(silent).toMatchObject({ status: 'acknowledged', responseInfo: 'buzzer off' });
    expect(badInterval).toMatchObject({ status: 'failed', responseInfo: 'sec must be 1..60' });
    expect(w.getUnit(id(0))).toMatchObject({ telemetryIntervalS: 2, buzzerEnabled: false });
    expect(w.sendCommand('nope', 'ping', {})).toBeNull();
  });

  it('tells the presenter what is happening and what comes next', () => {
    const w = world();
    w.advanceTo(at(5));
    expect(w.scenario().upcoming[0]).toEqual({ story: 'pursuit', label: 'ALPHA-03', seconds: 5 });
    w.advanceTo(at(80));
    expect(w.scenario().active.map((cue) => cue.story)).toEqual(expect.arrayContaining(['pursuit', 'fall']));
  });

  it('is repeatable for a seed and works for any fleet size', () => {
    expect(world(3).listUnits()).toEqual(world(3).listUnits());
    const pair = new DemoWorld({ roster: BUILT_IN_ROSTER.slice(0, 2), start: START, seed: 1 });
    pair.advanceTo(at(CYCLE_S));
    expect(pair.listUnits()).toHaveLength(2);
    const twelve = BUILT_IN_ROSTER.concat(BUILT_IN_ROSTER.map((entry) => ({ ...entry, deviceId: `${entry.deviceId}-b`, code: `${entry.code}B` })));
    expect(new DemoWorld({ roster: twelve, start: START, seed: 1 }).listUnits()).toHaveLength(12);
  });
});
