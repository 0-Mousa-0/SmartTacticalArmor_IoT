import type { AlertStatus, RiskFactor, RiskLevel, Severity } from '@/shared/domain/types';

/*
 * The server's analysis models, ported 1:1 so simulated risk scores, alert
 * priorities and AI findings follow exactly the rules the real backend applies:
 *   backend/app/models/alert_catalog.py         base priority of every alert type
 *   backend/app/services/analysis/alert_priority.py
 *   backend/app/services/analysis/risk_engine.py
 *   backend/app/services/analysis/anomaly_detector.py (+ config defaults)
 */

export const ALERT_BASE_PRIORITY: Record<string, number> = {
  SOS: 100,
  MAN_DOWN: 95,
  FALL: 90,
  IMPACT: 75,
  NO_MOTION: 60,
  VEST_TEMP_HIGH: 65,
  HR_HIGH: 70,
  HR_LOW: 78,
  SPO2_LOW: 82,
  SKIN_TEMP_HIGH: 62,
  SKIN_TEMP_LOW: 50,
  SENSOR_OFF: 30,
  BATTERY_LOW: 35,
  GPS_LOST: 25,
  RAD_RATE: 88,
  RAD_DOSE: 72,
  CONTACT_LOST: 70,
  TEMP_ANOMALY: 45,
  ACTIVITY_ANOMALY: 40,
  HR_ANOMALY: 55,
  SPO2_ANOMALY: 60,
  SKIN_TEMP_ANOMALY: 45,
  RADIATION_ANOMALY: 65,
};

/** The firmware's `alerts` bitmask order (bit 0 = SOS). */
export const DEVICE_ALERT_BITS = [
  'SOS', 'FALL', 'IMPACT', 'MAN_DOWN', 'NO_MOTION', 'HR_HIGH', 'HR_LOW', 'SPO2_LOW',
  'SKIN_TEMP_HIGH', 'SKIN_TEMP_LOW', 'RAD_RATE', 'RAD_DOSE', 'SENSOR_OFF', 'BATTERY_LOW', 'GPS_LOST', 'VEST_TEMP_HIGH',
] as const;

export const alertBit = (type: string): number => {
  const bit = (DEVICE_ALERT_BITS as readonly string[]).indexOf(type);
  return bit < 0 ? 0 : 1 << bit;
};

export const decodeAlertMask = (mask: number): string[] => DEVICE_ALERT_BITS.filter((_, bit) => (mask & (1 << bit)) !== 0);

export const OPEN_STATUSES: readonly AlertStatus[] = ['pending', 'open', 'acknowledged'];

/** Python's round(): an exact half goes to the even neighbour. */
export function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/* ── alert prioritisation ──────────────────────────────────────────────── */
const PRIORITY_SEVERITY: Record<Severity, number> = { critical: 1, warning: 0.7, info: 0.45 };
const PRIORITY_STATUS: Partial<Record<AlertStatus, number>> = { open: 1, pending: 0.9, acknowledged: 0.6 };

/** priority = base(type) x severity x status + age boost (max +10 after 5 min). */
export function computePriority(type: string, severity: Severity, status: AlertStatus, ageS = 0): number {
  const base = ALERT_BASE_PRIORITY[type] ?? 40;
  let score = base * (PRIORITY_SEVERITY[severity] ?? 0.45) * (PRIORITY_STATUS[status] ?? 0.2);
  if (status === 'open' || status === 'pending') score += Math.min(10, Math.max(0, ageS) / 30);
  return Math.max(0, Math.min(100, pyRound(score)));
}

/* ── wearer risk ───────────────────────────────────────────────────────── */
const RISK_SEVERITY: Record<Severity, number> = { critical: 1, warning: 0.6, info: 0.3 };

export const RISK_LEVELS: { minScore: number; level: RiskLevel }[] = [
  { minScore: 75, level: 'critical' },
  { minScore: 50, level: 'high' },
  { minScore: 20, level: 'elevated' },
];

export const levelFor = (score: number): RiskLevel => RISK_LEVELS.find((entry) => score >= entry.minScore)?.level ?? 'normal';

export interface RiskInputs {
  openAlerts: { type: string; severity: Severity; status: AlertStatus }[];
  connected: boolean;
  hasTelemetry: boolean;
  prealert: boolean;
  posture: string | null;
  stillS: number | null;
  vestTempC: number | null;
  anomalousMetrics: string[];
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
}

function alertPoints(alert: RiskInputs['openAlerts'][number]): number {
  const points = (ALERT_BASE_PRIORITY[alert.type] ?? 40) * (RISK_SEVERITY[alert.severity] ?? 0.3);
  return alert.status === 'acknowledged' ? points * 0.8 : points;
}

/** Strongest open incident + 15 % of the others (max 20) + context factors, clamped to 0..100. */
export function assessRisk(inputs: RiskInputs): RiskAssessment {
  const factors: RiskFactor[] = [];
  const scored = inputs.openAlerts.map((alert) => ({ alert, points: alertPoints(alert) })).sort((a, b) => b.points - a.points);
  if (scored.length) {
    const top = scored[0];
    factors.push({ code: `alert:${top.alert.type}`, points: pyRound(top.points), detail: top.alert.severity });
    const secondary = Math.min(20, 0.15 * scored.slice(1).reduce((sum, item) => sum + item.points, 0));
    if (secondary >= 1) factors.push({ code: 'alerts:additional', points: pyRound(secondary), detail: String(scored.length - 1) });
  }
  if (inputs.prealert) factors.push({ code: 'prealert', points: 30, detail: null });
  if (inputs.hasTelemetry && !inputs.connected) factors.push({ code: 'contact_lost', points: 30, detail: null });
  if (inputs.posture === 'lying') factors.push({ code: 'posture:lying', points: 15, detail: null });
  else if (inputs.posture === 'bent') factors.push({ code: 'posture:bent', points: 5, detail: null });
  if (inputs.stillS !== null && inputs.stillS >= 30) {
    factors.push({ code: 'immobile', points: pyRound(Math.min(20, 10 + (inputs.stillS - 30) / 9)), detail: String(inputs.stillS) });
  }
  if (inputs.vestTempC !== null) {
    if (inputs.vestTempC >= 45) factors.push({ code: 'heat:severe', points: 15, detail: inputs.vestTempC.toFixed(1) });
    else if (inputs.vestTempC >= 40) factors.push({ code: 'heat', points: 8, detail: inputs.vestTempC.toFixed(1) });
  }
  for (const metric of inputs.anomalousMetrics.slice(0, 2)) factors.push({ code: `anomaly:${metric}`, points: 10, detail: null });
  const score = Math.max(0, Math.min(100, pyRound(factors.reduce((sum, factor) => sum + factor.points, 0))));
  return { score, level: levelFor(score), factors };
}

/* ── explainable anomaly detection ─────────────────────────────────────── */
export type MetricName = 'vest_temp_c' | 'activity_g' | 'heart_rate' | 'spo2' | 'skin_temp_c' | 'radiation_usvh';

export interface MetricSpec {
  metric: MetricName;
  direction: 'up' | 'down' | 'both';
  minStd: number;
  alertType: string;
  unit: string;
}

export const METRIC_SPECS: MetricSpec[] = [
  { metric: 'vest_temp_c', direction: 'up', minStd: 0.4, alertType: 'TEMP_ANOMALY', unit: '°C' },
  { metric: 'activity_g', direction: 'up', minStd: 0.03, alertType: 'ACTIVITY_ANOMALY', unit: 'g' },
  { metric: 'heart_rate', direction: 'both', minStd: 4, alertType: 'HR_ANOMALY', unit: 'bpm' },
  { metric: 'spo2', direction: 'down', minStd: 1, alertType: 'SPO2_ANOMALY', unit: '%' },
  { metric: 'skin_temp_c', direction: 'both', minStd: 0.3, alertType: 'SKIN_TEMP_ANOMALY', unit: '°C' },
  { metric: 'radiation_usvh', direction: 'up', minStd: 0.05, alertType: 'RADIATION_ANOMALY', unit: 'µSv/h' },
];

/** ANALYSIS_* defaults of backend/app/config.py. */
export const DETECTOR = { zThreshold: 3, warmupSamples: 30, alpha: 0.05, anomalyWeight: 0.2, persistReadings: 3 } as const;

export const MODEL_METHOD = 'per-wearer online baseline (Welford warm-up, then EWMA mean/variance) + z-score';
export const PRIORITY_MODEL = 'base(type) x severity x status + age boost (max +10 after 5 min)';

export interface Baseline {
  mean: number;
  variance: number;
  samples: number;
  consecutive: number;
  lastValue: number | null;
  lastZ: number | null;
}

export const emptyBaseline = (): Baseline => ({ mean: 0, variance: 0, samples: 0, consecutive: 0, lastValue: null, lastZ: null });
export const baselineStd = (baseline: Baseline): number => (baseline.variance > 0 ? Math.sqrt(baseline.variance) : 0);

export interface Evaluation {
  z: number | null;
  meanBefore: number;
  stdBefore: number;
  isAnomaly: boolean;
}

/** Score `value` against the wearer's baseline, then learn from it (in place). */
export function evaluateMetric(spec: MetricSpec, value: number, state: Baseline): Evaluation {
  const warmingUp = state.samples < DETECTOR.warmupSamples;
  const meanBefore = state.mean;
  const stdBefore = baselineStd(state);
  let z: number | null = null;
  let isAnomaly = false;
  if (state.samples >= 2) {
    z = (value - state.mean) / Math.max(stdBefore, spec.minStd);
    if (!warmingUp) {
      if (spec.direction === 'up') isAnomaly = z > DETECTOR.zThreshold;
      else if (spec.direction === 'down') isAnomaly = z < -DETECTOR.zThreshold;
      else isAnomaly = Math.abs(z) > DETECTOR.zThreshold;
    }
  }
  learn(state, value, isAnomaly, warmingUp);
  state.consecutive = isAnomaly ? state.consecutive + 1 : 0;
  state.lastValue = value;
  state.lastZ = z;
  return { z, meanBefore, stdBefore, isAnomaly };
}

function learn(state: Baseline, x: number, isAnomaly: boolean, warmingUp: boolean): void {
  if (warmingUp || state.samples < 2) {
    // Welford's online algorithm (population variance).
    const n = state.samples + 1;
    const delta = x - state.mean;
    const mean = state.mean + delta / n;
    const m2 = state.variance * state.samples + delta * (x - mean);
    state.mean = mean;
    state.variance = m2 / n;
    state.samples = n;
    return;
  }
  const delta = x - state.mean;
  if (isAnomaly) {
    // Robust update: drift the mean slowly, keep the spread as learned.
    state.mean += DETECTOR.alpha * DETECTOR.anomalyWeight * delta;
    state.samples += 1;
    return;
  }
  state.mean += DETECTOR.alpha * delta;
  state.variance = (1 - DETECTOR.alpha) * (state.variance + DETECTOR.alpha * delta * delta);
  state.samples += 1;
}
