import { useI18n } from '@/core/i18n/useI18n';
import { AlertStatusBadge, SeverityBadge, SourceBadge } from '@/shared/ui';
import type { Alert } from '../../domain/Alert';
import { alertTarget } from '../../domain/Alert';
import s from './alerts.module.css';

const SEVERITY_BAR: Record<Alert['severity'], string> = {
  critical: 'var(--critical)',
  warning: 'var(--warning)',
  info: 'var(--info)',
};

/** Compact incident row used in the overview feed and the alerts list. */
export function AlertItem({ alert, selected, onSelect }: { alert: Alert; selected?: boolean; onSelect?: () => void }) {
  const { t, tx, fmt } = useI18n();
  const content = (
    <>
      <span className={s.bar} style={{ background: SEVERITY_BAR[alert.severity] }} />
      <div className={s.itemMain}>
        <div className={s.itemTitle}>
          <strong>{tx(`alertTypes.${alert.type}`, alert.type)}</strong>
          <span className={s.target}>{alertTarget(alert)}</span>
        </div>
        <div className={s.itemMeta}>
          <SeverityBadge severity={alert.severity} />
          <AlertStatusBadge status={alert.status} />
          {alert.source === 'analysis' && <SourceBadge source={alert.source} />}
        </div>
      </div>
      <div className={s.itemSide}>
        <span className={s.priority} title={t('alerts.priority')}>
          {alert.priority}
        </span>
        <span className={s.time}>{fmt.relative(alert.lastEventAt)}</span>
      </div>
    </>
  );
  return onSelect ? (
    <button type="button" className={`${s.item} ${selected ? s.itemSelected : ''}`} onClick={onSelect} aria-pressed={selected}>
      {content}
    </button>
  ) : (
    <div className={s.item}>{content}</div>
  );
}
