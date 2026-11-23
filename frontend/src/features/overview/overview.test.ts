import { describe, expect, it } from 'vitest';
import type { Unit } from '@/features/units/domain/Unit';
import { defaultSelection, heartRateTone, sortForOverview, spo2Tone, stateBreakdown, unitState } from './domain/overviewRules';

const unit = (id: string, overrides: Partial<Unit> = {}): Unit => ({
  id,
  code: id.toUpperCase(),
  name: id,
  isSimulated: true,
  isActive: true,
  notes: null,
  firmwareVersion: null,
  ipAddress: null,
  rssi: null,
  sensors: {},
  telemetryIntervalS: 5,
  buzzerEnabled: null,
  connection: 'online',
  lastSeenAt: null,
  telemetry: null,
  telemetryAt: null,
  wearer: null,
  deviceAlertsActive: [],
  openAlerts: [],
  risk: { score: 0, level: 'normal', factors: [], updatedAt: null },
  position: null,
  ...overrides,
});

const critical = { score: 90, level: 'critical' as const, factors: [], updatedAt: null };
const elevated = { score: 30, level: 'elevated' as const, factors: [], updatedAt: null };

describe('overview rules', () => {
  it('classifies units for the list, map legend and statistics', () => {
    expect(unitState(unit('a'))).toBe('normal');
    expect(unitState(unit('a', { risk: elevated }))).toBe('watch');
    expect(unitState(unit('a', { risk: critical }))).toBe('critical');
    expect(unitState(unit('a', { connection: 'offline', risk: critical }))).toBe('offline');
    expect(unitState(unit('a', { connection: 'never' }))).toBe('never');
  });

  it('counts never-connected vests as offline in the statistics', () => {
    const counts = stateBreakdown([unit('a'), unit('b', { risk: critical }), unit('c', { connection: 'never' }), unit('d', { connection: 'offline' })]);
    expect(counts).toEqual({ normal: 1, watch: 0, critical: 1, offline: 2, total: 4 });
  });

  it('lists the most urgent units first', () => {
    const sorted = sortForOverview([unit('sta-01'), unit('sta-02', { connection: 'never' }), unit('sta-03', { risk: critical })]);
    expect(sorted.map((u) => u.id)).toEqual(['sta-03', 'sta-01', 'sta-02']);
  });

  it('opens on the real vest when nothing needs attention', () => {
    const units = [unit('sim-1'), unit('real', { isSimulated: false }), unit('sim-2')];
    expect(defaultSelection(units, ['sim-1', 'real', 'sim-2'])).toBe('real');
  });

  it('opens on the most urgent online unit when one needs attention', () => {
    const units = [unit('real', { isSimulated: false }), unit('sim-2', { risk: critical })];
    expect(defaultSelection(units, ['sim-2', 'real'])).toBe('sim-2');
    expect(defaultSelection([], [])).toBeNull();
  });

  it('colours vitals with the vest alarm thresholds', () => {
    expect(heartRateTone(72)).toBe('normal');
    expect(heartRateTone(165)).toBe('warning');
    expect(heartRateTone(30)).toBe('critical');
    expect(spo2Tone(97)).toBe('normal');
    expect(spo2Tone(90)).toBe('warning');
    expect(spo2Tone(85)).toBe('critical');
  });
});
