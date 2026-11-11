import type { HttpClient } from '@/core/http/HttpClient';
import { toAlert, type AlertDto } from '@/features/alerts/data/AlertApi';
import { toSystemHealth, type SystemHealthDto } from '@/features/system/data/SystemApi';
import { toUnit, type DeviceViewDto } from '@/features/units/data/mappers';
import type { Overview, OverviewRepository } from '../domain/Overview';

interface OverviewDto {
  generated_at: string;
  kpis: Record<string, number>;
  units: DeviceViewDto[];
  priority_queue: string[];
  alerts: AlertDto[];
  system: SystemHealthDto;
}

export class OverviewApi implements OverviewRepository {
  constructor(private readonly http: HttpClient) {}

  async get(): Promise<Overview> {
    const dto = await this.http.get<OverviewDto>('/overview');
    const k = dto.kpis;
    return {
      generatedAt: dto.generated_at,
      kpis: {
        unitsTotal: k.units_total ?? 0,
        unitsOnline: k.units_online ?? 0,
        unitsOffline: k.units_offline ?? 0,
        unitsSimulated: k.units_simulated ?? 0,
        alertsOpen: k.alerts_open ?? 0,
        alertsCritical: k.alerts_critical ?? 0,
        alertsWarning: k.alerts_warning ?? 0,
        alertsPending: k.alerts_pending ?? 0,
        riskAverage: k.risk_average ?? 0,
        riskMax: k.risk_max ?? 0,
      },
      units: dto.units.map(toUnit),
      priorityQueue: dto.priority_queue,
      alerts: dto.alerts.map(toAlert),
      system: toSystemHealth(dto.system),
    };
  }
}
