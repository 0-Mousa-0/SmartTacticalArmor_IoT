import { useI18n } from '@/core/i18n/useI18n';
import type { AlertSource, AlertStatus, ConnectionState, RiskLevel, Severity } from '@/shared/domain/types';
import { Badge, Meter, type Tone } from './primitives';
import { RISK_COLOR } from './riskColors';

/** Domain-aware badges used across pages, so a status looks the same everywhere. */

const SEVERITY_TONE: Record<Severity, Tone> = { info: 'info', warning: 'warning', critical: 'critical' };

const STATUS_TONE: Record<AlertStatus, Tone> = {
  pending: 'warning',
  open: 'critical',
  acknowledged: 'info',
  resolved: 'success',
  cleared: 'neutral',
  cancelled: 'neutral',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useI18n();
  return (
    <Badge tone={SEVERITY_TONE[severity]} dot pulse={severity === 'critical'}>
      {t(`severity.${severity}`)}
    </Badge>
  );
}

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status]}>{t(`alertStatus.${status}`)}</Badge>;
}

export function SourceBadge({ source }: { source: AlertSource }) {
  const { t } = useI18n();
  return <Badge tone={source === 'analysis' ? 'ai' : 'neutral'}>{t(`alertSource.${source}`)}</Badge>;
}

export function ConnectionPill({ state }: { state: ConnectionState }) {
  const { t } = useI18n();
  const tone: Tone = state === 'online' ? 'success' : state === 'offline' ? 'critical' : 'neutral';
  return (
    <Badge tone={tone} dot pulse={state === 'online'}>
      {t(`connection.${state}`)}
    </Badge>
  );
}

export function SimulatedBadge() {
  const { t } = useI18n();
  return <Badge tone="ai">{t('common.simulated')}</Badge>;
}

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  const { t } = useI18n();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 9px',
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 700,
        color: RISK_COLOR[level],
        background: 'color-mix(in srgb, currentColor 14%, transparent)',
      }}
    >
      {score !== undefined && <span className="num">{score}</span>}
      {t(`risk.${level}`)}
    </span>
  );
}

export function RiskMeter({ level, score }: { level: RiskLevel; score: number }) {
  const { t } = useI18n();
  return <Meter value={score} color={RISK_COLOR[level]} label={t('risk.score')} />;
}
