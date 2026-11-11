import type { AlertSource, AlertStatus, ConnectionState, Posture, Risk, Severity } from '@/shared/domain/types';

export interface Wearer {
  id: string;
  callsign: string;
  fullName: string;
  rank: string | null;
  unitName: string | null;
  bloodType: string | null;
  zone: string | null;
  postLat: number | null;
  postLng: number | null;
}

/** Latest reading reported by the vest (Phase 2+ fields stay null until fitted). */
export interface LiveTelemetry {
  seq: number | null;
  uptimeS: number | null;
  vestTempC: number | null;
  tiltDeg: number | null;
  posture: Posture | null;
  activityG: number | null;
  peakG: number | null;
  stillS: number | null;
  rssi: number | null;
  alertMask: number;
  prealert: boolean;
  heartRate: number | null;
  spo2: number | null;
  skinTempC: number | null;
  lat: number | null;
  lng: number | null;
  gpsFix: boolean | null;
  radiationUsvh: number | null;
  radiationDoseUsv: number | null;
  batteryPct: number | null;
  anomalyScore: number | null;
}

export interface UnitAlertRef {
  id: string;
  type: string;
  severity: Severity;
  status: AlertStatus;
  source: AlertSource;
  priority: number;
}

export interface Position {
  lat: number;
  lng: number;
  source: 'gps' | 'post';
}

/** A field unit = one smart vest + the person wearing it + live state. */
export interface Unit {
  id: string;
  code: string;
  name: string;
  isSimulated: boolean;
  isActive: boolean;
  notes: string | null;
  firmwareVersion: string | null;
  ipAddress: string | null;
  rssi: number | null;
  sensors: Record<string, boolean | string>;
  telemetryIntervalS: number;
  buzzerEnabled: boolean | null;
  connection: ConnectionState;
  lastSeenAt: string | null;
  telemetry: LiveTelemetry | null;
  telemetryAt: string | null;
  wearer: Wearer | null;
  deviceAlertsActive: string[];
  openAlerts: UnitAlertRef[];
  risk: Risk;
  position: Position | null;
}

export interface TelemetryPoint {
  t: string;
  vestTempC: number | null;
  tiltDeg: number | null;
  activityG: number | null;
  peakG: number | null;
  heartRate: number | null;
  spo2: number | null;
  anomalyScore: number | null;
  prealert: boolean;
}

export type CommandType = 'ping' | 'ack' | 'evac' | 'stop' | 'interval' | 'silent' | 'calibrate' | 'status';
export type CommandStatus = 'queued' | 'sent' | 'acknowledged' | 'failed' | 'timeout';

export interface DeviceCommand {
  id: string;
  type: CommandType;
  params: Record<string, unknown>;
  correlationId: string;
  status: CommandStatus;
  responseOk: boolean | null;
  responseInfo: string | null;
  issuedBy: string | null;
  issuedAt: string;
  completedAt: string | null;
}

export interface UnitRepository {
  list(): Promise<Unit[]>;
  get(id: string): Promise<Unit>;
  history(id: string, minutes: number): Promise<TelemetryPoint[]>;
  commands(id: string): Promise<DeviceCommand[]>;
  sendCommand(id: string, type: CommandType, params?: Record<string, unknown>): Promise<DeviceCommand>;
}
