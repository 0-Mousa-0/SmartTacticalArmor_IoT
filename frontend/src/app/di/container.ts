import { tokenStore } from '@/core/auth/tokenStore';
import { env } from '@/core/config/env';
import { HttpClient } from '@/core/http/HttpClient';
import { AnalysisApi } from '@/features/analysis/data/AnalysisApi';
import { ArmorApi } from '@/features/armor/data/ArmorApi';
import { AlertApi } from '@/features/alerts/data/AlertApi';
import { AuthApi } from '@/features/auth/data/AuthApi';
import { FleetApi } from '@/features/fleet/data/FleetApi';
import { OverviewApi } from '@/features/overview/data/OverviewApi';
import { OperatorApi } from '@/features/settings/data/OperatorApi';
import { SystemApi } from '@/features/system/data/SystemApi';
import { UnitApi } from '@/features/units/data/UnitApi';
import type { Dependencies } from './types';

/**
 * Composition root: the only place that knows which concrete implementation
 * backs each repository interface. Tests build their own Dependencies with fakes.
 */
export function createHttpClient(): HttpClient {
  return new HttpClient({
    baseUrl: env.apiBaseUrl,
    getToken: () => tokenStore.get(),
    onUnauthorized: () => tokenStore.clear(),
  });
}

export function createDependencies(http: HttpClient = createHttpClient()): Dependencies {
  return {
    auth: new AuthApi(http),
    units: new UnitApi(http),
    alerts: new AlertApi(http),
    overview: new OverviewApi(http),
    analysis: new AnalysisApi(http),
    armor: new ArmorApi(http),
    fleet: new FleetApi(http),
    operators: new OperatorApi(http),
    system: new SystemApi(http),
  };
}
