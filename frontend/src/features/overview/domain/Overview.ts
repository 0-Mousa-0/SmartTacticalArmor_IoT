import type { Alert } from '@/features/alerts/domain/Alert';
import type { SystemHealth } from '@/features/system/domain/SystemHealth';
import type { Unit } from '@/features/units/domain/Unit';

export interface Kpis {
  personnelAssigned: number;
  unitsTotal: number;
  unitsOnline: number;
  unitsOffline: number;
  unitsSimulated: number;
  alertsOpen: number;
  alertsCritical: number;
  alertsWarning: number;
  alertsPending: number;
  riskAverage: number;
  riskMax: number;
}

export interface Overview {
  generatedAt: string;
  kpis: Kpis;
  units: Unit[];
  /** device ids ranked by the AI risk model, most urgent first */
  priorityQueue: string[];
  alerts: Alert[];
  system: SystemHealth;
}

export interface OverviewRepository {
  get(): Promise<Overview>;
}
