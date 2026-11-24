import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialMode, useDataSource } from '@/app/di/dataSource';
import type { Dependencies } from '@/app/di/types';
import { AppProviders } from '@/app/providers/AppProviders';
import type { Operator } from '@/features/auth/domain/Operator';
import { useUnits } from '@/features/units/application/hooks';
import { toUnit } from '@/features/units/data/mappers';
import { SourceSwitch } from './SourceSwitch';

const visitor: Operator = {
  id: '',
  fullName: 'Public access',
  email: '',
  role: 'admin',
  isActive: true,
  lastLoginAt: null,
  createdAt: null,
  isPublic: true,
};

/** A registered vest that has never sent anything (the situation simulation mode is for). */
const silentVest = (n: string) =>
  toUnit({
    device_id: `dev-${n}`,
    device_code: `STA-${n}`,
    display_name: `Vest STA-${n}`,
    is_simulated: false,
    is_active: true,
    notes: null,
    firmware_version: '2.1.0',
    ip_address: null,
    rssi: null,
    sensors: {},
    telemetry_interval_s: 5,
    buzzer_enabled: true,
    connection: 'never',
    last_seen_at: null,
    telemetry: null,
    telemetry_at: null,
    personnel: { personnel_id: `p-${n}`, callsign: `ALPHA-${n}`, full_name: `Member ${n}`, rank: null, zone: 'Riyadh', post_lat: 24.7, post_lng: 46.7 },
    device_alerts_active: [],
    open_alerts: [],
    risk: { score: 0, level: 'normal', factors: [], updated_at: null },
    position: { lat: 24.7, lng: 46.7, source: 'post' },
  });

function Probe() {
  const { mode } = useDataSource();
  const units = useUnits();
  return (
    <div>
      <SourceSwitch />
      <p>source: {mode}</p>
      <ul>
        {(units.data ?? []).map((unit) => (
          <li key={unit.id}>{`${unit.wearer?.callsign} ${unit.connection} ${unit.telemetry?.heartRate ?? '-'}`}</li>
        ))}
      </ul>
    </div>
  );
}

function renderWithLiveApi() {
  const units = { list: vi.fn().mockResolvedValue([silentVest('01'), silentVest('02')]), get: vi.fn(), history: vi.fn(), commands: vi.fn(), sendCommand: vi.fn() };
  const auth = { login: vi.fn(), me: vi.fn().mockResolvedValue(visitor), changePassword: vi.fn() };
  render(
    <AppProviders dependencies={{ auth, units } as unknown as Dependencies} lang="en">
      <Probe />
    </AppProviders>,
  );
  return units;
}

describe('simulation mode', () => {
  afterEach(() => window.localStorage.clear());

  it('switches to simulated readings for the real fleet, and back', async () => {
    renderWithLiveApi();
    expect(await screen.findByText('ALPHA-01 never -')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: 'Simulation' }));
    expect(await screen.findByText(/^ALPHA-01 online \d+$/)).toBeInTheDocument();
    expect(screen.getByText(/^ALPHA-02 online \d+$/)).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem('sta.dataSource')).toBe('demo');

    // Back to live: the real (silent) vests again, nothing simulated left over.
    await userEvent.click(screen.getByRole('switch'));
    expect(await screen.findByText('ALPHA-01 never -')).toBeInTheDocument();
    expect(screen.getByText('source: live')).toBeInTheDocument();
    expect(window.localStorage.getItem('sta.dataSource')).toBe('live');
  });

  it('starts from ?demo / ?live in the link, otherwise from the last choice', () => {
    expect(initialMode('?demo')).toBe('demo');
    expect(initialMode('?live')).toBe('live');
    expect(initialMode('')).toBe('live');
    window.localStorage.setItem('sta.dataSource', 'demo');
    expect(initialMode('')).toBe('demo');
    expect(initialMode('?live')).toBe('live');
  });
});
