import type { HttpClient } from '@/core/http/HttpClient';
import type { MqttHealth, SystemHealth, SystemRepository } from '../domain/SystemHealth';

export interface SystemHealthDto {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  mqtt: {
    enabled: boolean;
    connected: boolean;
    broker?: string;
    last_connected_at?: string | null;
    last_message_at?: string | null;
    messages_received?: number;
    last_error?: string | null;
  };
  version: string;
  time: string;
}

export const toSystemHealth = (dto: SystemHealthDto): SystemHealth => {
  const mqtt: MqttHealth = {
    enabled: dto.mqtt?.enabled ?? false,
    connected: dto.mqtt?.connected ?? false,
    broker: dto.mqtt?.broker,
    lastConnectedAt: dto.mqtt?.last_connected_at ?? null,
    lastMessageAt: dto.mqtt?.last_message_at ?? null,
    messagesReceived: dto.mqtt?.messages_received,
    lastError: dto.mqtt?.last_error ?? null,
  };
  return { status: dto.status, database: dto.database, mqtt, version: dto.version, time: dto.time };
};

export class SystemApi implements SystemRepository {
  constructor(private readonly http: HttpClient) {}

  async health(): Promise<SystemHealth> {
    return toSystemHealth(await this.http.get<SystemHealthDto>('/health'));
  }
}
