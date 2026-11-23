import type { Unit } from './Unit';

/** Pure presentation-independent rules about units (unit-tested). */

export const unitLabel = (unit: Unit): string => unit.wearer?.callsign ?? unit.code;

/** Where a unit stands right now: one scheme for the map, lists and statistics. */
export type UnitState = 'critical' | 'watch' | 'normal' | 'offline' | 'never';

export function unitState(unit: Unit): UnitState {
  if (unit.connection === 'never') return 'never';
  if (unit.connection !== 'online') return 'offline';
  if (unit.risk.level === 'critical' || unit.openAlerts.some((alert) => alert.severity === 'critical')) return 'critical';
  if (unit.risk.level !== 'normal' || unit.openAlerts.length > 0) return 'watch';
  return 'normal';
}

export const isAtRisk = (unit: Unit): boolean =>
  unit.risk.level === 'high' || unit.risk.level === 'critical' || unit.openAlerts.some((a) => a.severity === 'critical');

export function matchesSearch(unit: Unit, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [unit.code, unit.name, unit.wearer?.callsign, unit.wearer?.fullName, unit.wearer?.zone]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

/** Highest risk first; ties broken by open incidents, then vest code. */
export function sortByPriority(units: Unit[]): Unit[] {
  return [...units].sort(
    (a, b) => b.risk.score - a.risk.score || b.openAlerts.length - a.openAlerts.length || a.code.localeCompare(b.code),
  );
}

/** Optional sensors of the full Smart Tactical Armor concept and the phase that adds them. */
export type OptionalSensor = 'heartRate' | 'spo2' | 'skinTemp' | 'gps' | 'radiation' | 'battery';

export const SENSOR_PHASE: Record<OptionalSensor, number> = {
  heartRate: 2,
  spo2: 2,
  skinTemp: 2,
  battery: 2,
  gps: 3,
  radiation: 4,
};

const STATUS_KEY: Record<OptionalSensor, string> = {
  heartRate: 'ppg',
  spo2: 'ppg',
  skinTemp: 'temp',
  gps: 'gps',
  radiation: 'geiger',
  battery: 'bat',
};

/** A sensor counts as fitted when the vest reports it, or when its data arrives. */
export function hasSensor(unit: Unit, sensor: OptionalSensor): boolean {
  if (unit.sensors[STATUS_KEY[sensor]] === true) return true;
  const t = unit.telemetry;
  if (!t) return false;
  switch (sensor) {
    case 'heartRate':
      return t.heartRate !== null;
    case 'spo2':
      return t.spo2 !== null;
    case 'skinTemp':
      return t.skinTempC !== null;
    case 'gps':
      return t.lat !== null;
    case 'radiation':
      return t.radiationUsvh !== null;
    case 'battery':
      return t.batteryPct !== null;
  }
}
