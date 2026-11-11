import type { Alert } from '@/features/alerts/domain/Alert';
import type { ConnectionState, Risk } from '@/shared/domain/types';

export interface Baseline {
  metric: string;
  mean: number;
  std: number;
  samples: number;
  consecutiveAnomalies: number;
  lastValue: number | null;
  lastZ: number | null;
}

export interface AnalysisUnit {
  deviceId: string;
  deviceCode: string;
  isSimulated: boolean;
  callsign: string | null;
  fullName: string | null;
  connection: ConnectionState;
  risk: Risk;
  baselines: Baseline[];
}

export interface ModelCard {
  method: string;
  zThreshold: number;
  warmupSamples: number;
  alpha: number;
  persistReadings: number;
  metrics: { metric: string; direction: string; minStd: number; alertType: string }[];
  riskLevels: { minScore: number; level: string }[];
  priorityModel: string;
}

export interface AnalysisSummary {
  model: ModelCard;
  units: AnalysisUnit[];
  findings: Alert[];
}

export interface AnalysisRepository {
  summary(): Promise<AnalysisSummary>;
}
