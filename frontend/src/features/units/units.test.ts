import { describe, expect, it } from 'vitest';
import { toUnit, type DeviceViewDto } from './data/mappers';
import type { Unit } from './domain/Unit';
import { hasSensor, isAtRisk, matchesSearch, sortByPriority, unitLabel } from './domain/unitRules';

const dto = (overrides: Partial<DeviceViewDto> = {}): DeviceViewDto => ({
  device_id: 'd1',
  device_code: 'STA-01',
  display_name: 'Vest STA-01',
  is_simulated: false,
  is_active: true,
  notes: null,
  firmware_version: '2.0.0',
  ip_address: '192.168.1.20',
  rssi: -60,
  sensors: { imu: 'MPU-6050', ppg: false },
  telemetry_interval_s: 5,
  buzzer_enabled: true,
  connection: 'online',
  last_seen_at: '2026-11-11T10:00:00+00:00',
  telemetry: { vest_temp_c: 31.5, tilt_deg: 4, posture: 'upright', activity_g: 0.02, peak_g: 1.1, still_s: 3, alert_mask: 0, prealert: false },
  telemetry_at: '2026-11-11T10:00:00+00:00',
  personnel: { personnel_id: 'p1', callsign: 'ALPHA-01', full_name: 'Field Member 01', rank: null, zone: 'Central Riyadh', post_lat: 24.71, post_lng: 46.67 },
  device_alerts_active: [],
  open_alerts: [],
  risk: { score: 0, level: 'normal', factors: [], updated_at: null },
  position: { lat: 24.71, lng: 46.67, source: 'post' },
  ...overrides,
});

describe('unit mapping', () => {
  it('maps the API view model to the domain entity', () => {
    const unit = toUnit(dto());
    expect(unit.code).toBe('STA-01');
    expect(unit.wearer?.callsign).toBe('ALPHA-01');
    expect(unit.telemetry?.vestTempC).toBe(31.5);
    expect(unit.telemetry?.heartRate).toBeNull(); // Phase 2 sensor not fitted
    expect(unitLabel(unit)).toBe('ALPHA-01');
  });

  it('treats an empty telemetry snapshot as no telemetry', () => {
    expect(toUnit(dto({ telemetry: {} })).telemetry).toBeNull();
  });
});

describe('unit rules', () => {
  const withRisk = (id: string, score: number, level: Unit['risk']['level']): Unit =>
    toUnit(dto({ device_id: id, device_code: id, personnel: null, risk: { score, level, factors: [], updated_at: null } }));

  it('orders units by AI risk, most urgent first', () => {
    const sorted = sortByPriority([withRisk('A', 10, 'normal'), withRisk('B', 90, 'critical'), withRisk('C', 55, 'high')]);
    expect(sorted.map((u) => u.code)).toEqual(['B', 'C', 'A']);
  });

  it('flags high/critical risk or critical incidents as at risk', () => {
    expect(isAtRisk(withRisk('A', 10, 'normal'))).toBe(false);
    expect(isAtRisk(withRisk('B', 60, 'high'))).toBe(true);
  });

  it('searches callsign, name, vest code and zone', () => {
    const unit = toUnit(dto());
    expect(matchesSearch(unit, 'alpha')).toBe(true);
    expect(matchesSearch(unit, 'central')).toBe(true);
    expect(matchesSearch(unit, 'sta-01')).toBe(true);
    expect(matchesSearch(unit, 'bravo')).toBe(false);
  });

  it('detects fitted sensors from the status report or from data', () => {
    expect(hasSensor(toUnit(dto()), 'heartRate')).toBe(false);
    expect(hasSensor(toUnit(dto({ sensors: { ppg: true } })), 'heartRate')).toBe(true);
    expect(hasSensor(toUnit(dto({ telemetry: { radiation_usvh: 0.12 } })), 'radiation')).toBe(true);
  });
});
