import { useI18n } from '@/core/i18n/useI18n';
import type { SystemHealth } from '@/features/system/domain/SystemHealth';
import type { Unit } from '@/features/units/domain/Unit';
import { Badge, Card, Icon, Meter } from '@/shared/ui';
import { stateBreakdown, type UnitState } from '../../domain/overviewRules';
import s from '../overview.module.css';
import { STATE_COLOR, STATE_ICON, STATE_LABEL } from './state';

const CELLS: Exclude<UnitState, 'never'>[] = ['normal', 'watch', 'critical', 'offline'];

/** How many units are normal, under watch, critical or offline right now. */
export function StatusBreakdown({ units }: { units: Unit[] }) {
  const { t, fmt } = useI18n();
  const counts = stateBreakdown(units);
  return (
    <Card title={t('overview.breakdown')} subtitle={t('overview.breakdownHint')} className={s.stats}>
      <div className={s.breakdown}>
        {CELLS.map((state) => (
          <div key={state} className={s.stateCell}>
            <span className={s.stateHead}>
              <span className={s.stateIcon} style={{ color: STATE_COLOR[state] }}>
                <Icon name={STATE_ICON[state]} size={14} />
              </span>
              {t(STATE_LABEL[state])}
            </span>
            <span className={s.stateValue}>
              {fmt.number(counts[state])}
              <span className={s.stateOf}>/ {fmt.number(counts.total)}</span>
            </span>
            <Meter value={counts.total ? (counts[state] / counts.total) * 100 : 0} color={STATE_COLOR[state]} label={t(STATE_LABEL[state])} />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Database, broker and message flow, so the operator trusts what is on screen. */
export function SystemPanel({ health }: { health: SystemHealth }) {
  const { t, fmt } = useI18n();
  const mqtt = health.mqtt;
  return (
    <Card title={t('overview.system')} className={s.system}>
      <dl className={s.statusList}>
        <dt>
          <Icon name="database" size={16} /> {t('overview.database')}
        </dt>
        <dd>
          <Badge tone={health.database === 'ok' ? 'success' : 'critical'} dot>
            {health.database === 'ok' ? t('overview.connected') : t('overview.disconnected')}
          </Badge>
        </dd>
        <dt>
          <Icon name="link" size={16} /> {t('overview.broker')}
        </dt>
        <dd>
          {!mqtt.enabled ? (
            <Badge>{t('overview.disabled')}</Badge>
          ) : (
            <Badge tone={mqtt.connected ? 'success' : 'critical'} dot pulse={mqtt.connected}>
              {mqtt.connected ? t('overview.connected') : t('overview.disconnected')}
            </Badge>
          )}
        </dd>
        <dt>
          <Icon name="clock" size={16} /> {t('overview.lastMessage')}
        </dt>
        <dd>{fmt.relative(mqtt.lastMessageAt ?? null)}</dd>
        <dt>
          <Icon name="activity" size={16} /> {t('overview.messages')}
        </dt>
        <dd className="num">{fmt.number(mqtt.messagesReceived ?? null)}</dd>
      </dl>
    </Card>
  );
}
