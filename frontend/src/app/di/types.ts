import type { AnalysisRepository } from '@/features/analysis/domain/Analysis';
import type { ArmorRepository } from '@/features/armor/domain/Shielding';
import type { AlertRepository } from '@/features/alerts/domain/Alert';
import type { AuthRepository } from '@/features/auth/domain/Operator';
import type { FleetRepository } from '@/features/fleet/domain/Fleet';
import type { OverviewRepository } from '@/features/overview/domain/Overview';
import type { OperatorRepository } from '@/features/settings/domain/OperatorAccounts';
import type { SystemRepository } from '@/features/system/domain/SystemHealth';
import type { UnitRepository } from '@/features/units/domain/Unit';

/** Every repository the UI can use — interfaces only (dependency inversion). */
export interface Dependencies {
  auth: AuthRepository;
  units: UnitRepository;
  alerts: AlertRepository;
  overview: OverviewRepository;
  analysis: AnalysisRepository;
  armor: ArmorRepository;
  fleet: FleetRepository;
  operators: OperatorRepository;
  system: SystemRepository;
}
