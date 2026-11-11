import type { HttpClient } from '@/core/http/HttpClient';
import { toAlert, type AlertDto } from '@/features/alerts/data/AlertApi';
import type { ConnectionState, RiskLevel } from '@/shared/domain/types';
import type { AnalysisRepository, AnalysisSummary } from '../domain/Analysis';

interface AnalysisDto {
  model: {
    anomaly_detection: {
      method: string;
      z_threshold: number;
      warmup_samples: number;
      ewma_alpha: number;
      persist_readings: number;
      metrics: { metric: string; direction: string; min_std: number; alert_type: string }[];
    };
    risk_model: { levels: { min_score: number; level: string }[] };
    priority_model: string;
  };
  units: {
    device_id: string;
    device_code: string;
    is_simulated: boolean;
    personnel: { callsign: string; full_name: string } | null;
    connection: ConnectionState;
    risk: { score: number; level: RiskLevel; factors: { code: string; points: number; detail: string | null }[] };
    baselines: { metric: string; mean: number; std: number; samples: number; consecutive_anomalies: number; last_value: number | null; last_z: number | null }[];
  }[];
  findings: AlertDto[];
}

export class AnalysisApi implements AnalysisRepository {
  constructor(private readonly http: HttpClient) {}

  async summary(): Promise<AnalysisSummary> {
    const dto = await this.http.get<AnalysisDto>('/analysis');
    const ad = dto.model.anomaly_detection;
    return {
      model: {
        method: ad.method,
        zThreshold: ad.z_threshold,
        warmupSamples: ad.warmup_samples,
        alpha: ad.ewma_alpha,
        persistReadings: ad.persist_readings,
        metrics: ad.metrics.map((m) => ({ metric: m.metric, direction: m.direction, minStd: m.min_std, alertType: m.alert_type })),
        riskLevels: dto.model.risk_model.levels.map((l) => ({ minScore: l.min_score, level: l.level })),
        priorityModel: dto.model.priority_model,
      },
      units: dto.units.map((u) => ({
        deviceId: u.device_id,
        deviceCode: u.device_code,
        isSimulated: u.is_simulated,
        callsign: u.personnel?.callsign ?? null,
        fullName: u.personnel?.full_name ?? null,
        connection: u.connection,
        risk: { score: u.risk.score, level: u.risk.level, factors: u.risk.factors, updatedAt: null },
        baselines: u.baselines.map((b) => ({
          metric: b.metric,
          mean: b.mean,
          std: b.std,
          samples: b.samples,
          consecutiveAnomalies: b.consecutive_anomalies,
          lastValue: b.last_value,
          lastZ: b.last_z,
        })),
      })),
      findings: dto.findings.map(toAlert),
    };
  }
}
