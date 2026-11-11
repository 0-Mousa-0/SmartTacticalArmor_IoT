import type { AlertSource, AlertStatus, Severity } from '@/shared/domain/types';

export interface AlertEventEntry {
  id: number;
  kind: string;
  severity: Severity | null;
  value: number | null;
  actor: string | null;
  note: string | null;
  at: string;
}

/** One incident, raised by a vest or by the AI analysis. */
export interface Alert {
  id: string;
  type: string;
  source: AlertSource;
  severity: Severity;
  status: AlertStatus;
  isOpen: boolean;
  priority: number;
  value: number | null;
  message: string | null;
  context: Record<string, unknown>;
  deviceId: string;
  deviceCode: string | null;
  isSimulated: boolean;
  wearer: { id: string; callsign: string; fullName: string } | null;
  occurredAt: string;
  lastEventAt: string;
  eventCount: number;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  events: AlertEventEntry[];
}

export interface AlertQuery {
  scope: 'open' | 'closed' | 'all';
  severity?: Severity;
  source?: AlertSource;
  deviceId?: string;
  limit?: number;
}

export interface AlertPage {
  items: Alert[];
  total: number;
}

export interface AlertSummary {
  openTotal: number;
  openCritical: number;
  openWarning: number;
  openInfo: number;
}

export interface AlertRepository {
  list(query: AlertQuery): Promise<AlertPage>;
  get(id: string): Promise<Alert>;
  summary(): Promise<AlertSummary>;
  acknowledge(id: string, note?: string): Promise<{ alert: Alert; deviceNotified: boolean | null }>;
  resolve(id: string, note?: string): Promise<Alert>;
}

export const alertTarget = (alert: Alert): string => alert.wearer?.callsign ?? alert.deviceCode ?? '—';
