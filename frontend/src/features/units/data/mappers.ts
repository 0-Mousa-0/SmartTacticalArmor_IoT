import type { AlertSource, AlertStatus, ConnectionState, Posture, RiskLevel, Severity } from '@/shared/domain/types';
import type { DeviceCommand, LiveTelemetry, TelemetryPoint, Unit } from '../domain/Unit';

/* ── DTOs: the exact JSON shapes of the Flask API (snake_case) ─────────── */
export interface PersonnelViewDto {
  personnel_id: string;
  callsign: string;
  full_name: string;
  rank: string | null;
  unit_name?: string | null;
  blood_type?: string | null;
  zone?: string | null;
  post_lat?: number | null;
  post_lng?: number | null;
}

export interface TelemetrySnapshotDto {
  seq?: number | null;
  uptime_s?: number | null;
  vest_temp_c?: number | null;
  tilt_deg?: number | null;
  posture?: string | null;
  activity_g?: number | null;
  peak_g?: number | null;
  still_s?: number | null;
  rssi?: number | null;
  alert_mask?: number;
  prealert?: boolean;
  heart_rate?: number | null;
  spo2?: number | null;
  sensor_contact?: boolean | null;
  skin_temp_c?: number | null;
  lat?: number | null;
  lng?: number | null;
  gps_fix?: boolean | null;
  radiation_usvh?: number | null;
  radiation_dose_usv?: number | null;
  battery_pct?: number | null;
  anomaly_score?: number | null;
}

export interface DeviceViewDto {
  device_id: string;
  device_code: string;
  display_name: string;
  is_simulated: boolean;
  is_active: boolean;
  notes: string | null;
  firmware_version: string | null;
  ip_address: string | null;
  rssi: number | null;
  sensors: Record<string, boolean | string>;
  telemetry_interval_s: number;
  buzzer_enabled: boolean | null;
  connection: ConnectionState;
  last_seen_at: string | null;
  telemetry: TelemetrySnapshotDto | null;
  telemetry_at: string | null;
  personnel: PersonnelViewDto | null;
  device_alerts_active: string[];
  open_alerts: { alert_id: string; alert_type: string; severity: Severity; status: AlertStatus; source: AlertSource; priority: number }[];
  risk: { score: number; level: RiskLevel; factors: { code: string; points: number; detail: string | null }[]; updated_at: string | null };
  position: { lat: number; lng: number; source: 'gps' | 'post' } | null;
}

export interface TelemetryPointDto extends TelemetrySnapshotDto {
  t: string;
}

export interface CommandDto {
  command_id: string;
  command_type: DeviceCommand['type'];
  params: Record<string, unknown>;
  correlation_id: string;
  status: DeviceCommand['status'];
  response_ok: boolean | null;
  response_info: string | null;
  issued_by: string | null;
  issued_at: string;
  completed_at: string | null;
}

/* ── mappers: DTO -> domain entity ──────────────────────────────────────── */
const num = (value: number | null | undefined): number | null => (typeof value === 'number' ? value : null);
const POSTURES: Posture[] = ['upright', 'bent', 'lying', 'unknown'];

export function toTelemetry(dto: TelemetrySnapshotDto | null): LiveTelemetry | null {
  if (!dto || Object.keys(dto).length === 0) return null;
  return {
    seq: num(dto.seq),
    uptimeS: num(dto.uptime_s),
    vestTempC: num(dto.vest_temp_c),
    tiltDeg: num(dto.tilt_deg),
    posture: POSTURES.includes(dto.posture as Posture) ? (dto.posture as Posture) : null,
    activityG: num(dto.activity_g),
    peakG: num(dto.peak_g),
    stillS: num(dto.still_s),
    rssi: num(dto.rssi),
    alertMask: dto.alert_mask ?? 0,
    prealert: Boolean(dto.prealert),
    heartRate: num(dto.heart_rate),
    spo2: num(dto.spo2),
    sensorContact: typeof dto.sensor_contact === 'boolean' ? dto.sensor_contact : null,
    skinTempC: num(dto.skin_temp_c),
    lat: num(dto.lat),
    lng: num(dto.lng),
    gpsFix: dto.gps_fix ?? null,
    radiationUsvh: num(dto.radiation_usvh),
    radiationDoseUsv: num(dto.radiation_dose_usv),
    batteryPct: num(dto.battery_pct),
    anomalyScore: num(dto.anomaly_score),
  };
}

export function toUnit(dto: DeviceViewDto): Unit {
  const p = dto.personnel;
  return {
    id: dto.device_id,
    code: dto.device_code,
    name: dto.display_name,
    isSimulated: dto.is_simulated,
    isActive: dto.is_active,
    notes: dto.notes,
    firmwareVersion: dto.firmware_version,
    ipAddress: dto.ip_address,
    rssi: dto.rssi,
    sensors: dto.sensors ?? {},
    telemetryIntervalS: dto.telemetry_interval_s,
    buzzerEnabled: dto.buzzer_enabled,
    connection: dto.connection,
    lastSeenAt: dto.last_seen_at,
    telemetry: toTelemetry(dto.telemetry),
    telemetryAt: dto.telemetry_at,
    wearer: p
      ? {
          id: p.personnel_id,
          callsign: p.callsign,
          fullName: p.full_name,
          rank: p.rank,
          unitName: p.unit_name ?? null,
          bloodType: p.blood_type ?? null,
          zone: p.zone ?? null,
          postLat: p.post_lat ?? null,
          postLng: p.post_lng ?? null,
        }
      : null,
    deviceAlertsActive: dto.device_alerts_active ?? [],
    openAlerts: (dto.open_alerts ?? []).map((a) => ({
      id: a.alert_id,
      type: a.alert_type,
      severity: a.severity,
      status: a.status,
      source: a.source,
      priority: a.priority,
    })),
    risk: {
      score: dto.risk?.score ?? 0,
      level: dto.risk?.level ?? 'normal',
      factors: dto.risk?.factors ?? [],
      updatedAt: dto.risk?.updated_at ?? null,
    },
    position: dto.position,
  };
}

export const toTelemetryPoint = (dto: TelemetryPointDto): TelemetryPoint => ({
  t: dto.t,
  vestTempC: num(dto.vest_temp_c),
  tiltDeg: num(dto.tilt_deg),
  activityG: num(dto.activity_g),
  peakG: num(dto.peak_g),
  heartRate: num(dto.heart_rate),
  spo2: num(dto.spo2),
  anomalyScore: num(dto.anomaly_score),
  prealert: Boolean(dto.prealert),
});

export const toCommand = (dto: CommandDto): DeviceCommand => ({
  id: dto.command_id,
  type: dto.command_type,
  params: dto.params ?? {},
  correlationId: dto.correlation_id,
  status: dto.status,
  responseOk: dto.response_ok,
  responseInfo: dto.response_info,
  issuedBy: dto.issued_by,
  issuedAt: dto.issued_at,
  completedAt: dto.completed_at,
});
