import type { RiskLevel } from '@/shared/domain/types';

export const RISK_COLOR: Record<RiskLevel, string> = {
  normal: 'var(--risk-normal)',
  elevated: 'var(--risk-elevated)',
  high: 'var(--risk-high)',
  critical: 'var(--risk-critical)',
};
