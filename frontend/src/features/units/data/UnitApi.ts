import type { HttpClient } from '@/core/http/HttpClient';
import type { CommandType, DeviceCommand, TelemetryPoint, Unit, UnitRepository } from '../domain/Unit';
import { toCommand, toTelemetryPoint, toUnit, type CommandDto, type DeviceViewDto, type TelemetryPointDto } from './mappers';

export class UnitApi implements UnitRepository {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Unit[]> {
    return (await this.http.get<DeviceViewDto[]>('/devices')).map(toUnit);
  }

  async get(id: string): Promise<Unit> {
    return toUnit(await this.http.get<DeviceViewDto>(`/devices/${encodeURIComponent(id)}`));
  }

  async history(id: string, minutes: number): Promise<TelemetryPoint[]> {
    const dto = await this.http.get<{ points: TelemetryPointDto[] }>(`/devices/${encodeURIComponent(id)}/telemetry`, { minutes });
    return dto.points.map(toTelemetryPoint);
  }

  async commands(id: string): Promise<DeviceCommand[]> {
    return (await this.http.get<CommandDto[]>(`/devices/${encodeURIComponent(id)}/commands`, { limit: 15 })).map(toCommand);
  }

  async sendCommand(id: string, type: CommandType, params: Record<string, unknown> = {}): Promise<DeviceCommand> {
    return toCommand(await this.http.post<CommandDto>(`/devices/${encodeURIComponent(id)}/commands`, { command_type: type, params }));
  }
}
