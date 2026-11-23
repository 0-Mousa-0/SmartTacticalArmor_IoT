import type { Unit } from '@/features/units/domain/Unit';
import { unitState, type UnitState } from '@/features/units/domain/unitRules';

/** Pure rules behind the command overview (unit-tested, no React). */

export { unitState, type UnitState };

const STATE_ORDER: Record<UnitState, number> = { critical: 0, watch: 1, normal: 2, offline: 3, never: 4 };

/** Most urgent first; within a state, by vest code (stable while nothing changes). */
export function sortForOverview(units: Unit[]): Unit[] {
  return [...units].sort((a, b) => STATE_ORDER[unitState(a)] - STATE_ORDER[unitState(b)] || a.code.localeCompare(b.code));
}

export interface StateBreakdown {
  normal: number;
  watch: number;
  critical: number;
  /** offline + never connected */
  offline: number;
  total: number;
}

export function stateBreakdown(units: Unit[]): StateBreakdown {
  const counts: StateBreakdown = { normal: 0, watch: 0, critical: 0, offline: 0, total: units.length };
  for (const unit of units) {
    const state = unitState(unit);
    counts[state === 'never' ? 'offline' : state] += 1;
  }
  return counts;
}

/**
 * The unit the overview opens on: the most urgent online unit if any needs
 * attention, otherwise the first live (real hardware) vest that is online.
 */
export function defaultSelection(units: Unit[], priorityQueue: string[]): string | null {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const urgent = priorityQueue
    .map((id) => byId.get(id))
    .find((unit) => unit !== undefined && unitState(unit) !== 'normal' && unit.connection === 'online');
  if (urgent) return urgent.id;
  const pick =
    units.find((unit) => !unit.isSimulated && unit.connection === 'online') ??
    units.find((unit) => unit.connection === 'online') ??
    units.find((unit) => !unit.isSimulated) ??
    units[0];
  return pick?.id ?? null;
}

export type Tone = 'normal' | 'warning' | 'critical';

/** Display thresholds, the same as the vest's own alarms (firmware config.h). */
export function heartRateTone(bpm: number | null): Tone {
  if (bpm === null) return 'normal';
  if (bpm >= 190 || bpm <= 35) return 'critical';
  if (bpm >= 160 || bpm <= 45) return 'warning';
  return 'normal';
}

export function spo2Tone(percent: number | null): Tone {
  if (percent === null) return 'normal';
  if (percent < 88) return 'critical';
  if (percent < 92) return 'warning';
  return 'normal';
}

export function vestTempTone(celsius: number | null): Tone {
  if (celsius === null) return 'normal';
  if (celsius >= 55) return 'critical';
  if (celsius >= 45) return 'warning';
  return 'normal';
}
