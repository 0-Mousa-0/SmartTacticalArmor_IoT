import { ReadOnlyModeError } from '@/core/errors/ReadOnlyModeError';
import { ApiError } from '@/core/http/ApiError';
import { translate } from '@/core/i18n/translate';
import type { Lang } from '@/core/i18n/types';
import type { Alert, AlertPage, AlertQuery, AlertRepository, AlertSummary } from '@/features/alerts/domain/Alert';
import type { AnalysisRepository, AnalysisSummary } from '@/features/analysis/domain/Analysis';
import type { FleetRepository, Personnel } from '@/features/fleet/domain/Fleet';
import type { Overview, OverviewRepository } from '@/features/overview/domain/Overview';
import type { CommandType, DeviceCommand, TelemetryPoint, Unit, UnitRepository } from '@/features/units/domain/Unit';
import { SIM_ACTOR, SIM_NOTE } from '../domain/actors';
import type { DemoSession } from './DemoSession';

/*
 * The simulation behind the same repository interfaces as the HTTP API, so
 * every page works unchanged in simulation mode. Nothing here reaches the server.
 */

/** The page's language (I18nProvider keeps <html lang> in sync). */
const pageLang = (): Lang => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'ar');

/** The simulated duty officer's name and notes, in the page's language. */
function speak(text: string | null): string | null {
  if (text === SIM_ACTOR) return translate(pageLang(), 'demo.dutyOfficer');
  if (text === SIM_NOTE) return translate(pageLang(), 'demo.autoHandled');
  return text;
}

const localize = (alert: Alert): Alert => ({
  ...alert,
  acknowledgedBy: speak(alert.acknowledgedBy),
  resolvedBy: speak(alert.resolvedBy),
  resolutionNote: speak(alert.resolutionNote),
  events: alert.events.map((event) => ({ ...event, actor: speak(event.actor), note: speak(event.note) })),
});

function found<T>(value: T | null, what: string): T {
  if (value === null) throw new ApiError(404, `${what} not found`);
  return value;
}

export class DemoUnitRepository implements UnitRepository {
  constructor(private readonly session: DemoSession) {}

  async list(): Promise<Unit[]> {
    return (await this.session.world()).listUnits();
  }

  async get(id: string): Promise<Unit> {
    return found((await this.session.world()).getUnit(id), 'Device');
  }

  async history(id: string, minutes: number): Promise<TelemetryPoint[]> {
    return found((await this.session.world()).history(id, minutes), 'Device');
  }

  async commands(id: string): Promise<DeviceCommand[]> {
    const commands = found((await this.session.world()).commands(id), 'Device');
    return commands.map((command) => ({ ...command, issuedBy: speak(command.issuedBy) }));
  }

  async sendCommand(id: string, type: CommandType, params: Record<string, unknown> = {}): Promise<DeviceCommand> {
    return found((await this.session.world()).sendCommand(id, type, params), 'Device');
  }
}

export class DemoAlertRepository implements AlertRepository {
  constructor(private readonly session: DemoSession) {}

  async list(query: AlertQuery): Promise<AlertPage> {
    const page = (await this.session.world()).listAlerts(query);
    return { items: page.items.map(localize), total: page.total };
  }

  async get(id: string): Promise<Alert> {
    return localize(found((await this.session.world()).getAlert(id), 'Alert'));
  }

  async summary(): Promise<AlertSummary> {
    return (await this.session.world()).summary();
  }

  async acknowledge(id: string, note?: string) {
    const result = (await this.session.world()).acknowledge(id, note);
    if (!result.ok) throw actionError(result.reason);
    return { alert: localize(result.alert), deviceNotified: result.deviceNotified };
  }

  async resolve(id: string, note?: string): Promise<Alert> {
    const result = (await this.session.world()).resolve(id, note);
    if (!result.ok) throw actionError(result.reason);
    return localize(result.alert);
  }
}

const actionError = (reason: 'not_found' | 'closed'): ApiError =>
  reason === 'not_found' ? new ApiError(404, 'Alert not found') : new ApiError(409, 'This alert is already closed');

export class DemoOverviewRepository implements OverviewRepository {
  constructor(private readonly session: DemoSession) {}

  async get(): Promise<Overview> {
    const overview = (await this.session.world()).overview();
    return { ...overview, alerts: overview.alerts.map(localize) };
  }
}

export class DemoAnalysisRepository implements AnalysisRepository {
  constructor(private readonly session: DemoSession) {}

  async summary(): Promise<AnalysisSummary> {
    const summary = (await this.session.world()).analysis();
    return { ...summary, findings: summary.findings.map(localize) };
  }
}

/** The simulated fleet can be looked at, not edited: changes belong to the real registry. */
export class DemoFleetRepository implements FleetRepository {
  constructor(private readonly session: DemoSession) {}

  async listPersonnel(): Promise<Personnel[]> {
    return (await this.session.world()).personnel();
  }

  private readOnly(): Promise<never> {
    return Promise.reject(new ReadOnlyModeError());
  }

  createPersonnel = () => this.readOnly();
  updatePersonnel = () => this.readOnly();
  deactivatePersonnel = () => this.readOnly();
  registerVest = () => this.readOnly();
  updateVest = () => this.readOnly();
  retireVest = () => this.readOnly();
}
