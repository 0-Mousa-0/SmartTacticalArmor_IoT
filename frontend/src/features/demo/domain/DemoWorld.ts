import type { Alert, AlertPage, AlertQuery, AlertSummary } from '@/features/alerts/domain/Alert';
import type { AnalysisSummary } from '@/features/analysis/domain/Analysis';
import type { Personnel } from '@/features/fleet/domain/Fleet';
import type { Overview } from '@/features/overview/domain/Overview';
import type { SystemHealth } from '@/features/system/domain/SystemHealth';
import type { CommandType, DeviceCommand, LiveTelemetry, TelemetryPoint, Unit } from '@/features/units/domain/Unit';
import type { AlertSource, AlertStatus, ConnectionState, Risk, Severity } from '@/shared/domain/types';
import { SIM_ACTOR, SIM_NOTE } from './actors';
import { Body, ROUTINE_DRIVERS, type BodyReading, type Drivers } from './body';
import {
  alertBit,
  assessRisk,
  computePriority,
  decodeAlertMask,
  DETECTOR,
  emptyBaseline,
  evaluateMetric,
  METRIC_SPECS,
  MODEL_METHOD,
  OPEN_STATUSES,
  PRIORITY_MODEL,
  RISK_LEVELS,
  baselineStd,
  type Baseline,
  type Evaluation,
  type MetricName,
  type MetricSpec,
} from './models';
import { Rng, round } from './random';
import type { RosterEntry } from './roster';
import { CYCLE_S, EARLIER_TODAY, HEADLINE_S, profileFor, STORIES, TIMELINE, type StoryAction, type StoryKey } from './scenario';

/** The unit page's longest chart; history is simulated this far back. */
const HISTORY_MS = 6 * 3_600_000;
/** Older history is simulated in 10 s steps, the last 2 minutes second by second. */
const COARSE_STEP_S = 10;
const FINE_WINDOW_MS = 120_000;
const CYCLE_MS = CYCLE_S * 1000;

// Vest firmware (config.h) and server (config.py) settings the simulation obeys.
const DEFAULT_INTERVAL_S = 5;
const OFFLINE_MIN_S = 20;
const CONTACT_LOST_AFTER_S = 60;
const PREALERT_MS = 10_000;

/** A simulated duty officer handles incidents nobody answered, so the screen never fills up. */
const AUTO_ACK_S = 180;
const AUTO_RESOLVE_S = 240;
const KEEP_CLOSED_MS = 12 * 3_600_000;

/** One-shot incidents: they stay open until someone closes them. */
const EVENT_TYPES = new Set(['SOS', 'FALL', 'MAN_DOWN', 'IMPACT']);
const SEVERITY_RANK: Record<Severity, number> = { info: 1, warning: 2, critical: 3 };

type ConditionType = 'HR_HIGH' | 'HR_LOW' | 'SPO2_LOW' | 'VEST_TEMP_HIGH' | 'NO_MOTION';
const PERSIST_MS: Record<ConditionType, number> = { HR_HIGH: 10_000, HR_LOW: 10_000, SPO2_LOW: 10_000, VEST_TEMP_HIGH: 5_000, NO_MOTION: 0 };
const SPEC = Object.fromEntries(METRIC_SPECS.map((spec) => [spec.metric, spec])) as Record<MetricName, MetricSpec>;

interface ConditionState {
  active: boolean;
  severity: Severity | null;
  since: number | null;
}

/** An alert message as the vest sends it. */
interface VestAlert {
  type: string;
  severity: Severity;
  state: 'pending' | 'event' | 'active' | 'cleared' | 'cancelled';
  value: number;
  at: number;
  context: Record<string, number>;
}

interface SimEvent {
  id: number;
  kind: string;
  severity: Severity | null;
  value: number | null;
  actor: string | null;
  note: string | null;
  at: number;
}

interface SimAlert {
  id: string;
  type: string;
  source: AlertSource;
  severity: Severity;
  status: AlertStatus;
  value: number | null;
  message: string | null;
  context: Record<string, unknown>;
  slot: number;
  occurredAt: number;
  lastEventAt: number;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  resolvedAt: number | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  events: SimEvent[];
}

interface SimCommand {
  command: DeviceCommand;
  dueAt: number;
}

interface SimUnit {
  slot: number;
  entry: RosterEntry;
  body: Body;
  reading: BodyReading;
  drivers: Drivers;
  story: { key: StoryKey; start: number; step: number } | null;
  ramp: { from: number; start: number; seconds: number } | null;
  bentUntil: number;
  // the vest
  radio: boolean;
  interval: number;
  nextReport: number;
  seq: number;
  bootAt: number;
  buzzer: boolean;
  conditions: Record<ConditionType, ConditionState>;
  prealert: { type: string; start: number; value: number } | null;
  outbox: VestAlert[];
  // what the server knows
  lastSeenAt: number | null;
  telemetryAt: number | null;
  snapshot: LiveTelemetry | null;
  baselines: Map<MetricName, Baseline>;
  history: { at: number; point: TelemetryPoint }[];
  risk: Risk;
  commands: SimCommand[];
}

export interface ScenarioCue {
  story: StoryKey;
  label: string;
  /** seconds until it starts (upcoming) or since it started (active) */
  seconds: number;
}

export interface ScenarioStatus {
  cycleS: number;
  elapsedS: number;
  active: ScenarioCue[];
  upcoming: ScenarioCue[];
}

export type AlertActionResult = { ok: true; alert: Alert; deviceNotified: boolean | null } | { ok: false; reason: 'not_found' | 'closed' };

export interface WorldOptions {
  roster: RosterEntry[];
  /** epoch ms: the storyline starts here, history is simulated before it */
  start: number;
  seed?: number;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
const isOpen = (alert: SimAlert): boolean => OPEN_STATUSES.includes(alert.status);
const idle = (): ConditionState => ({ active: false, severity: null, since: null });

/**
 * The simulated operation: every unit of the roster wears a vest, follows its
 * routine and the scripted storyline, and the vest firmware's alarm rules plus
 * the server's AI (anomaly detection, risk, priorities) run on what it reports.
 * Time only moves when `advanceTo` is called, so it is exact and testable.
 */
export class DemoWorld {
  readonly start: number;
  private time: number;
  private readonly rng: Rng;
  private readonly units: SimUnit[];
  private alerts: SimAlert[] = [];
  private queue: { at: number; story: StoryKey; slot: number }[];
  private cycle = 0;
  private alertSeq = 0;
  private eventSeq = 0;
  private commandSeq = 0;
  private messages = 0;
  private lastMessageAt: number | null = null;
  private lastPrune = 0;

  constructor({ roster, start, seed }: WorldOptions) {
    this.start = start;
    this.rng = new Rng(seed ?? start);
    const from = start - HISTORY_MS;
    this.time = from;
    this.units = roster.map((entry, slot) => this.createUnit(entry, slot, from));
    this.queue = EARLIER_TODAY.filter((cue) => cue.slot < this.units.length)
      .map((cue) => ({ at: start + cue.at * 1000, story: cue.story, slot: cue.slot }))
      .sort((a, b) => a.at - b.at);
    this.advanceTo(start);
  }

  private createUnit(entry: RosterEntry, slot: number, from: number): SimUnit {
    const body = new Body(this.rng, profileFor(slot), from);
    return {
      slot,
      entry,
      body,
      reading: body.reading(),
      drivers: { ...ROUTINE_DRIVERS },
      story: null,
      ramp: null,
      bentUntil: 0,
      radio: true,
      interval: DEFAULT_INTERVAL_S,
      nextReport: from + ((slot * 830) % 5000),
      seq: 0,
      bootAt: from - (2 + slot) * 3_600_000,
      buzzer: true,
      conditions: { HR_HIGH: idle(), HR_LOW: idle(), SPO2_LOW: idle(), VEST_TEMP_HIGH: idle(), NO_MOTION: idle() },
      prealert: null,
      outbox: [],
      lastSeenAt: null,
      telemetryAt: null,
      snapshot: null,
      baselines: new Map(),
      history: [],
      risk: { score: 0, level: 'normal', factors: [], updatedAt: null },
      commands: [],
    };
  }

  /* ── time ─────────────────────────────────────────────────────────────── */

  /** Simulate up to `now` (epoch ms). Long gaps are covered in coarse steps. */
  advanceTo(now: number): void {
    if (now - this.time > HISTORY_MS) this.time = now - HISTORY_MS;
    const fineFrom = now - FINE_WINDOW_MS;
    while (this.time + COARSE_STEP_S * 1000 <= fineFrom) this.step(COARSE_STEP_S);
    while (this.time + 1000 <= now) this.step(1);
  }

  private step(dt: number): void {
    this.time += dt * 1000;
    const now = this.time;
    this.runTimeline(now);
    for (const unit of this.units) {
      this.runStory(unit, now, dt);
      unit.body.step(dt, now, unit.drivers);
      unit.reading = unit.body.reading();
      this.vestRules(unit, now);
      if (unit.radio && now >= unit.nextReport) this.report(unit, now);
      this.runCommands(unit, now);
    }
    this.housekeeping(now);
  }

  /* ── storyline ────────────────────────────────────────────────────────── */

  private runTimeline(now: number): void {
    while (now >= this.start + this.cycle * CYCLE_MS) {
      const base = this.start + this.cycle * CYCLE_MS;
      for (const cue of TIMELINE) {
        if (cue.slot < this.units.length) this.queue.push({ at: base + cue.at * 1000, story: cue.story, slot: cue.slot });
      }
      this.queue.sort((a, b) => a.at - b.at);
      this.cycle += 1;
    }
    while (this.queue.length && this.queue[0].at <= now) {
      const cue = this.queue.shift()!;
      this.beginStory(this.units[cue.slot], cue.story, cue.at, now);
    }
  }

  private beginStory(unit: SimUnit, key: StoryKey, at: number, now: number): void {
    if (!unit.radio) this.setRadio(unit, true, now);
    unit.story = { key, start: at, step: 0 };
    unit.ramp = null;
    unit.bentUntil = 0;
    unit.drivers = { ...ROUTINE_DRIVERS };
  }

  private runStory(unit: SimUnit, now: number, dt: number): void {
    const story = unit.story;
    if (story) {
      const steps = STORIES[story.key];
      while (story.step < steps.length && now >= story.start + steps[story.step].at * 1000) {
        for (const action of steps[story.step].actions) this.act(unit, action, now);
        story.step += 1;
      }
      if (story.step >= steps.length && !unit.ramp) unit.story = null;
    }
    if (unit.ramp) {
      const progress = (now - unit.ramp.start) / (unit.ramp.seconds * 1000);
      if (progress >= 1) {
        unit.ramp = null;
        unit.drivers = { ...ROUTINE_DRIVERS };
      } else {
        unit.drivers = { ...ROUTINE_DRIVERS, activity: unit.ramp.from + (unit.body.routineLevel - unit.ramp.from) * progress };
      }
    }
    if (!unit.story && !unit.ramp) this.routine(unit, now, dt);
  }

  /** The daily routine; now and then a guard bends for a while (checks a vehicle, ties a boot). */
  private routine(unit: SimUnit, now: number, dt: number): void {
    if (unit.bentUntil > now) return;
    if (unit.drivers.posture !== 'upright') unit.drivers = { ...ROUTINE_DRIVERS };
    if (unit.body.profile.routine !== 'patrol' && this.rng.chance(dt / 3600)) {
      unit.bentUntil = now + this.rng.range(15, 30) * 1000;
      unit.drivers = { ...ROUTINE_DRIVERS, posture: 'bent' };
    }
  }

  private act(unit: SimUnit, action: StoryAction, now: number): void {
    switch (action.type) {
      case 'drive':
        unit.ramp = null;
        unit.drivers = { ...ROUTINE_DRIVERS, ...action.drivers };
        break;
      case 'routine':
        unit.ramp = null;
        unit.drivers = { ...ROUTINE_DRIVERS };
        break;
      case 'ramp':
        unit.ramp = { from: unit.drivers.activity ?? unit.body.currentActivity, start: now, seconds: action.seconds };
        break;
      case 'fall':
        unit.body.jolt(action.peakG);
        if (!unit.prealert) {
          unit.prealert = { type: 'FALL', start: now, value: action.peakG };
          this.vestAlert(unit, 'FALL', 'info', 'pending', action.peakG, now);
        }
        break;
      case 'cancel':
        if (unit.prealert) {
          const { type, value } = unit.prealert;
          unit.prealert = null;
          this.vestAlert(unit, type, 'info', 'cancelled', value, now);
        }
        break;
      case 'impact':
        unit.body.jolt(action.peakG);
        this.vestAlert(unit, 'IMPACT', 'warning', 'event', action.peakG, now);
        break;
      case 'sos':
        this.vestAlert(unit, 'SOS', 'critical', 'event', 1, now);
        break;
      case 'fire':
        unit.drivers = { ...unit.drivers, heat: Math.max(12, action.reachC - unit.body.temperature) };
        break;
      case 'radio':
        this.setRadio(unit, action.on, now);
        break;
    }
  }

  private setRadio(unit: SimUnit, on: boolean, now: number): void {
    unit.radio = on;
    if (!on) return;
    // Store-and-forward: alerts raised while offline arrive with their own time.
    for (const message of unit.outbox.splice(0)) this.receiveVestAlert(unit, message, now);
    unit.nextReport = now;
  }

  /* ── the vest (firmware alarm rules) ──────────────────────────────────── */

  private vestRules(unit: SimUnit, now: number): void {
    const r = unit.reading;
    if (unit.prealert && now - unit.prealert.start >= PREALERT_MS) {
      const { type, value } = unit.prealert;
      unit.prealert = null; // nobody pressed "I'm OK": escalate
      this.vestAlert(unit, type, 'critical', 'event', value, now);
    }
    this.condition(unit, 'HR_HIGH', r.heartRate >= 190 ? 'critical' : r.heartRate >= 160 ? 'warning' : null, r.heartRate, now);
    this.condition(unit, 'HR_LOW', r.heartRate <= 35 ? 'critical' : r.heartRate <= 45 ? 'warning' : null, r.heartRate, now);
    this.condition(unit, 'SPO2_LOW', r.spo2 < 88 ? 'critical' : r.spo2 < 92 ? 'warning' : null, r.spo2, now);
    this.condition(unit, 'VEST_TEMP_HIGH', r.vestTempC >= 55 ? 'critical' : r.vestTempC >= 45 ? 'warning' : null, r.vestTempC, now);
    const still = r.stillS >= 60;
    this.condition(unit, 'NO_MOTION', still ? (r.tiltDeg >= 55 ? 'critical' : 'warning') : null, r.stillS, now);
  }

  private condition(unit: SimUnit, type: ConditionType, severity: Severity | null, value: number, now: number): void {
    const state = unit.conditions[type];
    if (severity) {
      if (state.since === null) state.since = now;
      if (now - state.since < PERSIST_MS[type]) return;
      if (!state.active || severity !== state.severity) {
        state.active = true;
        state.severity = severity;
        this.vestAlert(unit, type, severity, 'active', value, now);
      }
      return;
    }
    state.since = null;
    if (state.active) {
      state.active = false;
      state.severity = null;
      this.vestAlert(unit, type, 'info', 'cleared', value, now);
    }
  }

  private vestAlert(unit: SimUnit, type: string, severity: Severity, state: VestAlert['state'], value: number, now: number): void {
    const r = unit.reading;
    const message: VestAlert = {
      type,
      severity,
      state,
      value: round(value, 2),
      at: now,
      context: { tilt: r.tiltDeg, vest_t: r.vestTempC, hr: r.heartRate, spo2: r.spo2 },
    };
    if (!unit.radio) {
      unit.outbox.push(message);
      if (unit.outbox.length > 16) unit.outbox.shift();
      return;
    }
    this.receiveVestAlert(unit, message, now);
  }

  /* ── the server: alert ingestion (backend facade/alerts.py) ───────────── */

  private receiveVestAlert(unit: SimUnit, m: VestAlert, receivedAt: number): void {
    this.markSeen(unit, receivedAt);
    let alert = this.findOpen(unit.slot, m.type);
    let kind: string = m.state;
    if (m.state === 'pending') {
      if (alert) this.touch(alert, m, receivedAt);
      else alert = this.newAlert(unit, m.type, 'device', m.severity, 'pending', m.at, m.value, null, m.context);
    } else if (m.state === 'event' || m.state === 'active') {
      if (!alert) {
        alert = this.newAlert(unit, m.type, 'device', m.severity, 'open', m.at, m.value, null, m.context);
      } else {
        const escalated = SEVERITY_RANK[m.severity] > SEVERITY_RANK[alert.severity];
        if (alert.status === 'pending') {
          alert.status = 'open';
          if (escalated) kind = 'escalated';
        } else if (escalated) {
          kind = 'escalated';
          // A worse condition after acknowledgement needs a fresh acknowledgement.
          if (alert.status === 'acknowledged' && m.severity === 'critical') {
            alert.status = 'open';
            kind = 'reopened';
          }
        }
        if (m.state === 'active' || escalated) alert.severity = m.severity;
        this.touch(alert, m, receivedAt);
      }
    } else if (m.state === 'cleared') {
      if (!alert) return;
      alert.status = 'cleared';
      alert.resolvedAt = m.at;
      this.touch(alert, m, receivedAt);
    } else if (alert) {
      alert.status = 'cancelled';
      alert.resolvedAt = m.at;
      this.touch(alert, m, receivedAt);
    } else {
      alert = this.newAlert(unit, m.type, 'device', 'info', 'cancelled', m.at, m.value, null, m.context);
      alert.resolvedAt = m.at;
    }
    this.addEvent(alert, kind, receivedAt, { severity: m.severity, value: m.value });
    this.refreshRisk(unit, receivedAt);
  }

  private touch(alert: SimAlert, m: VestAlert, now: number): void {
    alert.value = m.value;
    alert.context = { ...alert.context, ...m.context };
    alert.lastEventAt = now;
  }

  private newAlert(
    unit: SimUnit,
    type: string,
    source: AlertSource,
    severity: Severity,
    status: AlertStatus,
    at: number,
    value: number | null,
    message: string | null,
    context: Record<string, unknown>,
  ): SimAlert {
    this.alertSeq += 1;
    const alert: SimAlert = {
      id: `demo-alert-${String(this.alertSeq).padStart(5, '0')}`,
      type,
      source,
      severity,
      status,
      value,
      message,
      context: { ...context },
      slot: unit.slot,
      occurredAt: at,
      lastEventAt: at,
      acknowledgedAt: null,
      acknowledgedBy: null,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
      events: [],
    };
    this.alerts.push(alert);
    return alert;
  }

  private addEvent(alert: SimAlert, kind: string, at: number, extra: Partial<Omit<SimEvent, 'id' | 'kind' | 'at'>> = {}): void {
    this.eventSeq += 1;
    alert.events.push({ id: this.eventSeq, kind, severity: null, value: null, actor: null, note: null, at, ...extra });
  }

  private findOpen(slot: number, type: string): SimAlert | undefined {
    for (let i = this.alerts.length - 1; i >= 0; i -= 1) {
      const alert = this.alerts[i];
      if (alert.slot === slot && alert.type === type && isOpen(alert)) return alert;
    }
    return undefined;
  }

  private openAlertsFor(slot: number): SimAlert[] {
    return this.alerts.filter((alert) => alert.slot === slot && isOpen(alert));
  }

  /* ── the server: telemetry ingestion + AI (backend facade/telemetry.py) ── */

  private report(unit: SimUnit, now: number): void {
    const r = unit.reading;
    unit.nextReport = now + unit.interval * 1000;
    unit.seq += 1;
    this.markSeen(unit, now);

    let anomalyScore: number | null = null;
    const values: [MetricName, number][] = [
      ['vest_temp_c', r.vestTempC],
      ['activity_g', r.activityG],
      ['heart_rate', r.heartRate],
      ['spo2', r.spo2],
    ];
    for (const [metric, value] of values) {
      const spec = SPEC[metric];
      let baseline = unit.baselines.get(metric);
      if (!baseline) {
        baseline = emptyBaseline();
        unit.baselines.set(metric, baseline);
      }
      const evaluation = evaluateMetric(spec, value, baseline);
      if (evaluation.z !== null) anomalyScore = Math.max(anomalyScore ?? 0, Math.abs(evaluation.z));
      if (baseline.consecutive >= DETECTOR.persistReadings) this.raiseAnomaly(unit, spec, value, evaluation, baseline.consecutive, now);
      else if (baseline.consecutive === 0) this.clearAnalysis(unit, spec.alertType, now, `${metric} back within baseline`);
    }

    let mask = 0;
    for (const [type, state] of Object.entries(unit.conditions)) if (state.active) mask |= alertBit(type);
    if (unit.prealert) mask |= alertBit(unit.prealert.type);

    unit.snapshot = {
      seq: unit.seq,
      uptimeS: Math.floor((now - unit.bootAt) / 1000),
      vestTempC: r.vestTempC,
      tiltDeg: r.tiltDeg,
      posture: r.posture,
      activityG: r.activityG,
      peakG: r.peakG,
      stillS: r.stillS,
      rssi: r.rssi,
      alertMask: mask,
      prealert: unit.prealert !== null,
      heartRate: r.heartRate,
      spo2: r.spo2,
      sensorContact: true,
      skinTempC: null,
      lat: null,
      lng: null,
      gpsFix: null,
      radiationUsvh: null,
      radiationDoseUsv: null,
      batteryPct: null,
      anomalyScore: anomalyScore === null ? null : round(anomalyScore, 2),
    };
    unit.telemetryAt = now;
    unit.history.push({
      at: now,
      point: {
        t: new Date(now).toISOString(),
        vestTempC: r.vestTempC,
        tiltDeg: r.tiltDeg,
        activityG: r.activityG,
        peakG: r.peakG,
        heartRate: r.heartRate,
        spo2: r.spo2,
        anomalyScore: unit.snapshot.anomalyScore,
        prealert: unit.snapshot.prealert,
      },
    });
    unit.body.resetPeak();
    this.clearAnalysis(unit, 'CONTACT_LOST', now, 'Contact restored');
    this.refreshRisk(unit, now);
  }

  private raiseAnomaly(unit: SimUnit, spec: MetricSpec, value: number, e: Evaluation, consecutive: number, now: number): void {
    const z = e.z ?? 0;
    const message =
      `${spec.metric} = ${value.toFixed(2)}${spec.unit}, usual ${e.meanBefore.toFixed(2)}` +
      ` ± ${e.stdBefore.toFixed(2)}${spec.unit} (z = ${z.toFixed(1)})`;
    const context = {
      metric: spec.metric,
      z: round(z, 2),
      baseline_mean: round(e.meanBefore, 3),
      baseline_std: round(e.stdBefore, 3),
      consecutive,
    };
    const open = this.findOpen(unit.slot, spec.alertType);
    if (open) {
      // Already open: refresh it, don't spam the timeline.
      open.value = value;
      open.message = message;
      open.context = context;
      open.lastEventAt = now;
      return;
    }
    const alert = this.newAlert(unit, spec.alertType, 'analysis', 'warning', 'open', now, value, message, context);
    this.addEvent(alert, 'detected', now, { severity: 'warning', value });
  }

  private clearAnalysis(unit: SimUnit, type: string, now: number, note: string): void {
    const alert = this.findOpen(unit.slot, type);
    if (!alert || alert.source !== 'analysis') return;
    alert.status = 'cleared';
    alert.resolvedAt = now;
    alert.lastEventAt = now;
    alert.resolutionNote = note;
    this.addEvent(alert, 'cleared', now, { note });
  }

  private markSeen(unit: SimUnit, at: number): void {
    if (unit.lastSeenAt === null || at >= unit.lastSeenAt) unit.lastSeenAt = at;
    this.messages += 1;
    this.lastMessageAt = at;
  }

  private connection(unit: SimUnit, now: number): ConnectionState {
    if (unit.lastSeenAt === null) return 'never';
    return now - unit.lastSeenAt <= Math.max(OFFLINE_MIN_S, 3 * unit.interval) * 1000 ? 'online' : 'offline';
  }

  private refreshRisk(unit: SimUnit, now: number): void {
    const snapshot = unit.snapshot;
    const anomalous = [...unit.baselines.entries()]
      .filter(([, baseline]) => baseline.consecutive >= DETECTOR.persistReadings)
      .map(([metric]) => metric)
      .sort();
    const assessment = assessRisk({
      openAlerts: this.openAlertsFor(unit.slot).map((alert) => ({ type: alert.type, severity: alert.severity, status: alert.status })),
      connected: this.connection(unit, now) === 'online',
      hasTelemetry: unit.lastSeenAt !== null,
      prealert: snapshot?.prealert ?? false,
      posture: snapshot?.posture ?? null,
      stillS: snapshot?.stillS ?? null,
      vestTempC: snapshot?.vestTempC ?? null,
      anomalousMetrics: anomalous,
    });
    unit.risk = { ...assessment, updatedAt: new Date(now).toISOString() };
  }

  /* ── the server: housekeeping and the simulated duty officer ──────────── */

  private housekeeping(now: number): void {
    for (const unit of this.units) {
      if (unit.lastSeenAt !== null) {
        const silentS = (now - unit.lastSeenAt) / 1000;
        if (silentS >= Math.max(CONTACT_LOST_AFTER_S, 3 * unit.interval) && !this.findOpen(unit.slot, 'CONTACT_LOST')) {
          const value = Math.round(silentS);
          const alert = this.newAlert(unit, 'CONTACT_LOST', 'analysis', 'warning', 'open', now, value,
            `No data from ${unit.entry.code} for ${Math.floor(silentS)} s`, { last_seen_at: iso(unit.lastSeenAt) });
          this.addEvent(alert, 'detected', now, { severity: 'warning', value });
        }
      }
      this.dutyOfficer(unit, now);
      this.refreshRisk(unit, now);
    }
    if (now - this.lastPrune >= 60_000) this.prune(now);
  }

  private dutyOfficer(unit: SimUnit, now: number): void {
    for (const alert of this.openAlertsFor(unit.slot)) {
      if (alert.source !== 'device') continue;
      if (alert.status === 'open' && now - alert.occurredAt >= AUTO_ACK_S * 1000) {
        this.acknowledgeAlert(alert, now, SIM_ACTOR, null);
      } else if (
        alert.status === 'acknowledged' &&
        EVENT_TYPES.has(alert.type) &&
        alert.acknowledgedAt !== null &&
        now - alert.acknowledgedAt >= AUTO_RESOLVE_S * 1000 &&
        !unit.prealert &&
        unit.snapshot?.posture !== 'lying'
      ) {
        this.resolveAlert(alert, now, SIM_ACTOR, SIM_NOTE);
      }
    }
  }

  private acknowledgeAlert(alert: SimAlert, now: number, actor: string | null, note: string | null): boolean | null {
    if (alert.status === 'acknowledged') return null;
    alert.status = 'acknowledged';
    alert.acknowledgedAt = now;
    alert.acknowledgedBy = actor;
    this.addEvent(alert, 'acknowledged', now, { actor, note });
    const unit = this.units[alert.slot];
    this.refreshRisk(unit, now);
    if (alert.source !== 'device') return null;
    // Tell the wearer help is coming (vibration + "OK" on the LED matrix).
    this.queueCommand(unit, 'ack', { type: alert.type }, actor, now);
    return true;
  }

  private resolveAlert(alert: SimAlert, now: number, actor: string | null, note: string | null): void {
    alert.status = 'resolved';
    alert.resolvedAt = now;
    alert.resolvedBy = actor;
    alert.resolutionNote = (note ?? '').trim().slice(0, 500) || null;
    if (alert.acknowledgedAt === null) {
      alert.acknowledgedAt = now;
      alert.acknowledgedBy = actor;
    }
    this.addEvent(alert, 'resolved', now, { actor, note: alert.resolutionNote });
    this.refreshRisk(this.units[alert.slot], now);
  }

  private prune(now: number): void {
    this.lastPrune = now;
    const oldest = now - HISTORY_MS - 600_000;
    for (const unit of this.units) {
      const keepFrom = unit.history.findIndex((entry) => entry.at >= oldest);
      if (keepFrom > 0) unit.history.splice(0, keepFrom);
    }
    this.alerts = this.alerts.filter((alert) => isOpen(alert) || alert.lastEventAt >= now - KEEP_CLOSED_MS);
  }

  /* ── commands from the operations room ────────────────────────────────── */

  private queueCommand(unit: SimUnit, type: CommandType, params: Record<string, unknown>, actor: string | null, now: number): DeviceCommand {
    this.commandSeq += 1;
    const command: DeviceCommand = {
      id: `demo-cmd-${this.commandSeq}`,
      type,
      params,
      correlationId: `demo-${this.commandSeq.toString(16)}`,
      status: 'sent',
      responseOk: null,
      responseInfo: null,
      issuedBy: actor,
      issuedAt: new Date(now).toISOString(),
      completedAt: null,
    };
    // An unreachable vest never answers: the server marks the command "no response".
    unit.commands.unshift({ command, dueAt: now + (unit.radio ? this.rng.range(700, 1600) : 15_000) });
    unit.commands.length = Math.min(unit.commands.length, 30);
    return command;
  }

  private runCommands(unit: SimUnit, now: number): void {
    for (const pending of unit.commands) {
      const { command } = pending;
      if (command.status !== 'sent' || now < pending.dueAt) continue;
      command.completedAt = new Date(now).toISOString();
      if (!unit.radio) {
        command.status = 'timeout';
        continue;
      }
      const [ok, info] = this.answer(unit, command, now);
      command.status = ok ? 'acknowledged' : 'failed';
      command.responseOk = ok;
      command.responseInfo = info;
    }
  }

  /** The vest firmware's reply to each command (and what it changes). */
  private answer(unit: SimUnit, command: DeviceCommand, now: number): [boolean, string] {
    switch (command.type) {
      case 'ping':
        return [true, 'pong'];
      case 'ack':
        return [true, String(command.params.type ?? '')];
      case 'interval': {
        const seconds = Number(command.params.sec ?? 0);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) return [false, 'sec must be 1..60'];
        unit.interval = seconds;
        unit.nextReport = now;
        return [true, ''];
      }
      case 'silent': {
        const on = command.params.on !== false;
        unit.buzzer = !on;
        return [true, on ? 'buzzer off' : 'buzzer on'];
      }
      case 'calibrate':
        return [true, 'upright reference updated'];
      default:
        return [true, ''];
    }
  }

  /* ── read models (the same shapes the API returns) ────────────────────── */

  private label(unit: SimUnit): string {
    return unit.entry.wearer?.callsign ?? unit.entry.code;
  }

  private unitView(unit: SimUnit, now: number): Unit {
    const wearer = unit.entry.wearer;
    const open = this.openAlertsFor(unit.slot)
      .map((alert) => ({
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        status: alert.status,
        source: alert.source,
        priority: computePriority(alert.type, alert.severity, alert.status, (now - alert.occurredAt) / 1000),
      }))
      .sort((a, b) => b.priority - a.priority);
    return {
      id: unit.entry.deviceId,
      code: unit.entry.code,
      name: unit.entry.name,
      isSimulated: true,
      isActive: true,
      notes: unit.entry.notes,
      firmwareVersion: unit.entry.firmwareVersion ?? '2.1.0',
      ipAddress: `10.0.0.${11 + (unit.slot % 240)}`,
      rssi: unit.snapshot?.rssi ?? null,
      sensors: { imu: 'MPU-6050', ppg: 'simulated', temp: false, gps: false, geiger: false, bat: false },
      telemetryIntervalS: unit.interval,
      buzzerEnabled: unit.buzzer,
      connection: this.connection(unit, now),
      lastSeenAt: iso(unit.lastSeenAt),
      telemetry: unit.snapshot ? { ...unit.snapshot } : null,
      telemetryAt: iso(unit.telemetryAt),
      wearer: wearer ? { ...wearer } : null,
      deviceAlertsActive: decodeAlertMask(unit.snapshot?.alertMask ?? 0),
      openAlerts: open,
      risk: { ...unit.risk, factors: unit.risk.factors.map((factor) => ({ ...factor })) },
      position:
        wearer && wearer.postLat !== null && wearer.postLng !== null ? { lat: wearer.postLat, lng: wearer.postLng, source: 'post' } : null,
    };
  }

  private alertView(alert: SimAlert, now: number, withEvents: boolean): Alert {
    const unit = this.units[alert.slot];
    const wearer = unit.entry.wearer;
    return {
      id: alert.id,
      type: alert.type,
      source: alert.source,
      severity: alert.severity,
      status: alert.status,
      isOpen: isOpen(alert),
      priority: computePriority(alert.type, alert.severity, alert.status, (now - alert.occurredAt) / 1000),
      value: alert.value,
      message: alert.message,
      context: { ...alert.context },
      deviceId: unit.entry.deviceId,
      deviceCode: unit.entry.code,
      isSimulated: true,
      wearer: wearer ? { id: wearer.id, callsign: wearer.callsign, fullName: wearer.fullName } : null,
      occurredAt: new Date(alert.occurredAt).toISOString(),
      lastEventAt: new Date(alert.lastEventAt).toISOString(),
      eventCount: alert.events.length,
      acknowledgedAt: iso(alert.acknowledgedAt),
      acknowledgedBy: alert.acknowledgedBy,
      resolvedAt: iso(alert.resolvedAt),
      resolvedBy: alert.resolvedBy,
      resolutionNote: alert.resolutionNote,
      events: withEvents
        ? alert.events.map((event) => ({
            id: event.id,
            kind: event.kind,
            severity: event.severity,
            value: event.value,
            actor: event.actor,
            note: event.note,
            at: new Date(event.at).toISOString(),
          }))
        : [],
    };
  }

  private findUnit(id: string): SimUnit | undefined {
    return this.units.find((unit) => unit.entry.deviceId === id);
  }

  listUnits(): Unit[] {
    const now = this.time;
    return [...this.units].sort((a, b) => a.entry.code.localeCompare(b.entry.code)).map((unit) => this.unitView(unit, now));
  }

  getUnit(id: string): Unit | null {
    const unit = this.findUnit(id);
    return unit ? this.unitView(unit, this.time) : null;
  }

  /** Readings of the last `minutes`, at most 720 points spread evenly (like the API's limit). */
  history(id: string, minutes: number): TelemetryPoint[] | null {
    const unit = this.findUnit(id);
    if (!unit) return null;
    const from = this.time - Math.max(1, Math.min(minutes, 24 * 60)) * 60_000;
    const points = unit.history.filter((entry) => entry.at >= from).map((entry) => ({ ...entry.point }));
    if (points.length <= 720) return points;
    const stride = points.length / 720;
    return Array.from({ length: 720 }, (_, i) => points[Math.floor(i * stride)]);
  }

  commands(id: string): DeviceCommand[] | null {
    const unit = this.findUnit(id);
    return unit ? unit.commands.slice(0, 15).map((pending) => ({ ...pending.command, params: { ...pending.command.params } })) : null;
  }

  sendCommand(id: string, type: CommandType, params: Record<string, unknown>, actor: string | null = null): DeviceCommand | null {
    const unit = this.findUnit(id);
    if (!unit) return null;
    return { ...this.queueCommand(unit, type, { ...params }, actor, this.time) };
  }

  listAlerts(query: AlertQuery): AlertPage {
    const now = this.time;
    const device = query.deviceId ? this.findUnit(query.deviceId) : undefined;
    const matching = this.alerts.filter(
      (alert) =>
        (query.scope === 'all' || (query.scope === 'open') === isOpen(alert)) &&
        (!query.severity || alert.severity === query.severity) &&
        (!query.source || alert.source === query.source) &&
        (!query.deviceId || alert.slot === device?.slot),
    );
    const views = matching.map((alert) => this.alertView(alert, now, false));
    if (query.scope === 'open') views.sort((a, b) => b.priority - a.priority || b.lastEventAt.localeCompare(a.lastEventAt));
    else views.sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt));
    const limit = Math.max(1, Math.min(query.limit ?? 100, 200));
    return { items: views.slice(0, limit), total: views.length };
  }

  getAlert(id: string): Alert | null {
    const alert = this.alerts.find((item) => item.id === id);
    return alert ? this.alertView(alert, this.time, true) : null;
  }

  summary(): AlertSummary {
    const open = this.alerts.filter(isOpen);
    return {
      openTotal: open.length,
      openCritical: open.filter((alert) => alert.severity === 'critical').length,
      openWarning: open.filter((alert) => alert.severity === 'warning').length,
      openInfo: open.filter((alert) => alert.severity === 'info').length,
    };
  }

  acknowledge(id: string, note?: string, actor: string | null = null): AlertActionResult {
    const alert = this.alerts.find((item) => item.id === id);
    if (!alert) return { ok: false, reason: 'not_found' };
    if (!isOpen(alert)) return { ok: false, reason: 'closed' };
    const notified = this.acknowledgeAlert(alert, this.time, actor, note?.trim() || null);
    return { ok: true, alert: this.alertView(alert, this.time, true), deviceNotified: notified };
  }

  resolve(id: string, note?: string, actor: string | null = null): AlertActionResult {
    const alert = this.alerts.find((item) => item.id === id);
    if (!alert) return { ok: false, reason: 'not_found' };
    if (!isOpen(alert)) return { ok: false, reason: 'closed' };
    this.resolveAlert(alert, this.time, actor, note ?? null);
    return { ok: true, alert: this.alertView(alert, this.time, true), deviceNotified: null };
  }

  /** The "simulator" stands in for the broker and the database. */
  systemHealth(): SystemHealth {
    return {
      status: 'ok',
      database: 'ok',
      mqtt: {
        enabled: true,
        connected: true,
        broker: 'built-in simulator',
        lastConnectedAt: new Date(this.start).toISOString(),
        lastMessageAt: iso(this.lastMessageAt),
        messagesReceived: this.messages,
        lastError: null,
      },
      version: 'simulation',
      time: new Date(this.time).toISOString(),
    };
  }

  overview(): Overview {
    const now = this.time;
    const units = this.listUnits();
    const open = this.alerts.filter(isOpen);
    const online = units.filter((unit) => unit.connection === 'online').length;
    const risks = units.filter((unit) => unit.connection !== 'never').map((unit) => unit.risk.score);
    const queue = [...units].sort((a, b) => b.risk.score - a.risk.score || b.openAlerts.length - a.openAlerts.length);
    const top = open
      .map((alert) => this.alertView(alert, now, false))
      .sort((a, b) => b.priority - a.priority || b.lastEventAt.localeCompare(a.lastEventAt))
      .slice(0, 8);
    return {
      generatedAt: new Date(now).toISOString(),
      kpis: {
        personnelAssigned: units.filter((unit) => unit.wearer).length,
        unitsTotal: units.length,
        unitsOnline: online,
        unitsOffline: units.length - online,
        unitsSimulated: units.length,
        alertsOpen: open.length,
        alertsCritical: open.filter((alert) => alert.severity === 'critical').length,
        alertsWarning: open.filter((alert) => alert.severity === 'warning').length,
        alertsPending: open.filter((alert) => alert.status === 'pending').length,
        riskAverage: risks.length ? Math.round(risks.reduce((sum, score) => sum + score, 0) / risks.length) : 0,
        riskMax: risks.length ? Math.max(...risks) : 0,
      },
      units,
      priorityQueue: queue.slice(0, 5).map((unit) => unit.id),
      alerts: top,
      system: this.systemHealth(),
    };
  }

  analysis(): AnalysisSummary {
    const now = this.time;
    const units = [...this.units]
      .map((unit) => {
        const wearer = unit.entry.wearer;
        return {
          deviceId: unit.entry.deviceId,
          deviceCode: unit.entry.code,
          isSimulated: true,
          callsign: wearer?.callsign ?? null,
          fullName: wearer?.fullName ?? null,
          connection: this.connection(unit, now),
          risk: { score: unit.risk.score, level: unit.risk.level, factors: unit.risk.factors.map((f) => ({ ...f })), updatedAt: null },
          baselines: [...unit.baselines.entries()]
            .filter(([, baseline]) => baseline.samples > 0)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([metric, baseline]) => ({
              metric,
              mean: round(baseline.mean, 3),
              std: round(baselineStd(baseline), 3),
              samples: baseline.samples,
              consecutiveAnomalies: baseline.consecutive,
              lastValue: baseline.lastValue,
              lastZ: baseline.lastZ === null ? null : round(baseline.lastZ, 2),
            })),
        };
      })
      .sort((a, b) => b.risk.score - a.risk.score);
    const findings = this.alerts
      .filter((alert) => alert.source === 'analysis')
      .sort((a, b) => b.lastEventAt - a.lastEventAt)
      .slice(0, 25)
      .map((alert) => this.alertView(alert, now, false));
    return {
      model: {
        method: MODEL_METHOD,
        zThreshold: DETECTOR.zThreshold,
        warmupSamples: DETECTOR.warmupSamples,
        alpha: DETECTOR.alpha,
        persistReadings: DETECTOR.persistReadings,
        metrics: METRIC_SPECS.map((spec) => ({ metric: spec.metric, direction: spec.direction, minStd: spec.minStd, alertType: spec.alertType })),
        riskLevels: RISK_LEVELS.map((entry) => ({ minScore: entry.minScore, level: entry.level })),
        priorityModel: PRIORITY_MODEL,
      },
      units,
      findings,
    };
  }

  personnel(): Personnel[] {
    return this.units
      .filter((unit) => unit.entry.wearer)
      .map((unit) => {
        const w = unit.entry.wearer!;
        return {
          id: w.id,
          callsign: w.callsign,
          fullName: w.fullName,
          rank: w.rank,
          unitName: w.unitName,
          bloodType: w.bloodType,
          zone: w.zone,
          postLat: w.postLat,
          postLng: w.postLng,
          notes: null,
          isActive: true,
          deviceId: unit.entry.deviceId,
          deviceCode: unit.entry.code,
        };
      })
      .sort((a, b) => a.callsign.localeCompare(b.callsign));
  }

  /** Where the storyline stands: what is happening and what comes next. */
  scenario(): ScenarioStatus {
    const now = this.time;
    const elapsed = Math.max(0, now - this.start);
    const active = this.units
      .filter((unit) => unit.story && unit.story.start >= this.start && now - unit.story.start < HEADLINE_S[unit.story.key] * 1000)
      .map((unit) => ({ story: unit.story!.key, label: this.label(unit), seconds: Math.floor((now - unit.story!.start) / 1000) }));
    const upcoming: ScenarioCue[] = [];
    const firstCycle = Math.floor(elapsed / CYCLE_MS);
    for (let cycle = firstCycle; upcoming.length < 3 && cycle < firstCycle + 2; cycle += 1) {
      for (const cue of TIMELINE) {
        const at = this.start + cycle * CYCLE_MS + cue.at * 1000;
        if (at > now && cue.slot < this.units.length && upcoming.length < 3) {
          upcoming.push({ story: cue.story, label: this.label(this.units[cue.slot]), seconds: Math.ceil((at - now) / 1000) });
        }
      }
    }
    return { cycleS: CYCLE_S, elapsedS: Math.floor((elapsed % CYCLE_MS) / 1000), active, upcoming };
  }
}
