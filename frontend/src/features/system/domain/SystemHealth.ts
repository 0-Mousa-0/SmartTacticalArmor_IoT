export interface MqttHealth {
  enabled: boolean;
  connected: boolean;
  broker?: string;
  lastConnectedAt?: string | null;
  lastMessageAt?: string | null;
  messagesReceived?: number;
  lastError?: string | null;
}

export interface SystemHealth {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  mqtt: MqttHealth;
  version: string;
  time: string;
}

export interface SystemRepository {
  health(): Promise<SystemHealth>;
}
