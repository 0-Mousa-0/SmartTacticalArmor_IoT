import type { HttpClient } from '@/core/http/HttpClient';
import type { AlertSource, AlertStatus, Severity } from '@/shared/domain/types';
import type { Alert, AlertPage, AlertQuery, AlertRepository, AlertSummary } from '../domain/Alert';

export interface AlertDto {
  alert_id: string;
  alert_type: string;
  source: AlertSource;
  severity: Severity;
  status: AlertStatus;
  is_open: boolean;
  priority: number;
  value: number | null;
  message: string | null;
  context: Record<string, unknown>;
  device_id: string;
  device_code: string | null;
  is_simulated: boolean;
  personnel: { personnel_id: string; callsign: string; full_name: string } | null;
  occurred_at: string;
  last_event_at: string;
  event_count: number;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  events?: { event_id: number; kind: string; severity: Severity | null; value: number | null; actor: string | null; note: string | null; received_at: string }[];
  device_notified?: boolean | null;
}

export const toAlert = (dto: AlertDto): Alert => ({
  id: dto.alert_id,
  type: dto.alert_type,
  source: dto.source,
  severity: dto.severity,
  status: dto.status,
  isOpen: dto.is_open,
  priority: dto.priority,
  value: dto.value,
  message: dto.message,
  context: dto.context ?? {},
  deviceId: dto.device_id,
  deviceCode: dto.device_code,
  isSimulated: dto.is_simulated,
  wearer: dto.personnel ? { id: dto.personnel.personnel_id, callsign: dto.personnel.callsign, fullName: dto.personnel.full_name } : null,
  occurredAt: dto.occurred_at,
  lastEventAt: dto.last_event_at,
  eventCount: dto.event_count,
  acknowledgedAt: dto.acknowledged_at,
  acknowledgedBy: dto.acknowledged_by,
  resolvedAt: dto.resolved_at,
  resolvedBy: dto.resolved_by,
  resolutionNote: dto.resolution_note,
  events: (dto.events ?? []).map((e) => ({
    id: e.event_id,
    kind: e.kind,
    severity: e.severity,
    value: e.value,
    actor: e.actor,
    note: e.note,
    at: e.received_at,
  })),
});

export class AlertApi implements AlertRepository {
  constructor(private readonly http: HttpClient) {}

  async list(query: AlertQuery): Promise<AlertPage> {
    const dto = await this.http.get<{ items: AlertDto[]; total: number }>('/alerts', {
      scope: query.scope,
      severity: query.severity,
      source: query.source,
      device_id: query.deviceId,
      limit: query.limit ?? 100,
    });
    return { items: dto.items.map(toAlert), total: dto.total };
  }

  async get(id: string): Promise<Alert> {
    return toAlert(await this.http.get<AlertDto>(`/alerts/${encodeURIComponent(id)}`));
  }

  async summary(): Promise<AlertSummary> {
    const dto = await this.http.get<Record<string, number>>('/alerts/summary');
    return {
      openTotal: dto.open_total ?? 0,
      openCritical: dto.open_critical ?? 0,
      openWarning: dto.open_warning ?? 0,
      openInfo: dto.open_info ?? 0,
    };
  }

  async acknowledge(id: string, note?: string) {
    const dto = await this.http.post<AlertDto>(`/alerts/${encodeURIComponent(id)}/acknowledge`, { note });
    return { alert: toAlert(dto), deviceNotified: dto.device_notified ?? null };
  }

  async resolve(id: string, note?: string): Promise<Alert> {
    return toAlert(await this.http.post<AlertDto>(`/alerts/${encodeURIComponent(id)}/resolve`, { note }));
  }
}
