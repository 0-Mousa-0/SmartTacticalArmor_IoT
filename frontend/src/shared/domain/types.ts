/** Domain primitives shared by several features (framework-free). */

export type Severity = 'info' | 'warning' | 'critical';
export type RiskLevel = 'normal' | 'elevated' | 'high' | 'critical';
export type ConnectionState = 'online' | 'offline' | 'never';
export type AlertStatus = 'pending' | 'open' | 'acknowledged' | 'resolved' | 'cleared' | 'cancelled';
export type AlertSource = 'device' | 'analysis';
export type Posture = 'upright' | 'bent' | 'lying' | 'unknown';
export type Role = 'admin' | 'operator' | 'viewer';

export const OPEN_ALERT_STATUSES: readonly AlertStatus[] = ['pending', 'open', 'acknowledged'];

export const SEVERITY_RANK: Record<Severity, number> = { info: 1, warning: 2, critical: 3 };

export interface RiskFactor {
  code: string;
  points: number;
  detail: string | null;
}

export interface Risk {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  updatedAt: string | null;
}

export const canOperate = (role: Role | undefined): boolean => role === 'admin' || role === 'operator';
export const isAdmin = (role: Role | undefined): boolean => role === 'admin';
