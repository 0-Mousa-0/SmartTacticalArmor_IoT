import { tokenStore } from '@/core/auth/tokenStore';
import { env } from '@/core/config/env';
import { HttpClient } from '@/core/http/HttpClient';
import { AnalysisApi } from '@/features/analysis/data/AnalysisApi';
import { ArmorApi } from '@/features/armor/data/ArmorApi';
import { AlertApi } from '@/features/alerts/data/AlertApi';
import { AuthApi } from '@/features/auth/data/AuthApi';
import {
  DemoAlertRepository,
  DemoAnalysisRepository,
  DemoFleetRepository,
  DemoOverviewRepository,
  DemoUnitRepository,
} from '@/features/demo/data/demoRepositories';
import { DemoSession } from '@/features/demo/data/DemoSession';
import { rosterFromUnits } from '@/features/demo/domain/roster';
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

/** A new simulation, cast with the real fleet when the registry can be read. */
export function createDemoSession(live: Dependencies): DemoSession {
  return new DemoSession(async () => rosterFromUnits(await live.units.list()));
}

/**
 * Simulation mode: field data (units, alerts, overview, AI analysis, fleet)
 * comes from the simulation in the browser; sign-in, operator accounts,
 * server health and the armor calculator stay on the real API.
 */
export function createDemoDependencies(live: Dependencies, session: DemoSession): Dependencies {
  return {
    auth: live.auth,
    operators: live.operators,
    armor: live.armor,
    system: live.system,
    units: new DemoUnitRepository(session),
    alerts: new DemoAlertRepository(session),
    overview: new DemoOverviewRepository(session),
    analysis: new DemoAnalysisRepository(session),
    fleet: new DemoFleetRepository(session),
  };
}
