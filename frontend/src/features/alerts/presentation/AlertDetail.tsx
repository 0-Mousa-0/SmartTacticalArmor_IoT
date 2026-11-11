import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { useAuth } from '@/features/auth/application/authContext';
import { canOperate } from '@/shared/domain/types';
import {
  AlertStatusBadge,
  Button,
  SeverityBadge,
  SimulatedBadge,
  SourceBadge,
  TextAreaField,
  useErrorMessage,
  useToast,
  uiStyles,
} from '@/shared/ui';
import { useAcknowledgeAlert, useResolveAlert } from '../application/hooks';
import { alertTarget, type Alert } from '../domain/Alert';
import s from './components/alerts.module.css';

export function AlertDetail({ alert }: { alert: Alert }) {
  const { t, tx, fmt } = useI18n();
  const { operator } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const acknowledge = useAcknowledgeAlert();
  const resolve = useResolveAlert();
  const [note, setNote] = useState('');
  const allowed = canOperate(operator?.role);

  const onAcknowledge = () =>
    acknowledge.mutate(
      { id: alert.id, note: note || undefined },
      {
        onSuccess: (result) =>
          toast.show(result.deviceNotified === false ? t('alerts.acknowledgedNoVest') : t('alerts.acknowledged'), result.deviceNotified === false ? 'error' : 'success'),
        onError: (error) => toast.show(errorMessage(error), 'error'),
      },
    );

  const onResolve = () =>
    resolve.mutate(
      { id: alert.id, note: note || undefined },
      {
        onSuccess: () => {
          setNote('');
          toast.show(t('alerts.resolved'), 'success');
        },
        onError: (error) => toast.show(errorMessage(error), 'error'),
      },
    );

  const contextEntries = Object.entries(alert.context).filter(([, value]) => value !== null && value !== undefined);

  return (
    <div>
      <div className={s.detailHeader}>
        <h2 className={s.detailTitle}>{tx(`alertTypes.${alert.type}`, alert.type)}</h2>
        <Link to={`/units/${alert.deviceId}`}>
          {alertTarget(alert)}
          {alert.wearer && ` — ${alert.wearer.fullName}`} · <span className="ltr">{alert.deviceCode}</span>
        </Link>
        <div className={s.badges}>
          <SeverityBadge severity={alert.severity} />
          <AlertStatusBadge status={alert.status} />
          <SourceBadge source={alert.source} />
          {alert.isSimulated && <SimulatedBadge />}
        </div>
      </div>

      {alert.message && <p className={s.message}>{alert.message}</p>}

      <dl className={uiStyles.kv}>
        <dt>{t('alerts.priority')}</dt>
        <dd className="num">{alert.priority}</dd>
        <dt>{t('alerts.occurred')}</dt>
        <dd>{fmt.dateTime(alert.occurredAt)}</dd>
        <dt>{t('alerts.lastEvent')}</dt>
        <dd>{fmt.relative(alert.lastEventAt)}</dd>
        {alert.value !== null && (
          <>
            <dt>{t('alerts.value')}</dt>
            <dd className="num">{fmt.number(alert.value, 2)}</dd>
          </>
        )}
        {contextEntries.map(([key, value]) => (
          <div key={key} style={{ display: 'contents' }}>
            <dt>{tx(`alertContext.${key}`, key)}</dt>
            <dd className="num">
              {typeof value === 'number'
                ? fmt.number(value, 2)
                : key === 'metric'
                  ? tx(`metrics.${String(value)}`, String(value))
                  : key === 'last_seen_at'
                    ? fmt.dateTime(String(value))
                    : String(value)}
            </dd>
          </div>
        ))}
        {alert.acknowledgedBy && (
          <>
            <dt>{t('alertStatus.acknowledged')}</dt>
            <dd>{t('alerts.by', { name: alert.acknowledgedBy })}</dd>
          </>
        )}
        {alert.resolutionNote && (
          <>
            <dt>{t('alerts.note')}</dt>
            <dd>{alert.resolutionNote}</dd>
          </>
        )}
      </dl>

      {alert.isOpen && allowed && (
        <div className={s.actions}>
          <TextAreaField label={t('alerts.note')} placeholder={t('alerts.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          <div className={s.actionButtons}>
            {alert.status !== 'acknowledged' && (
              <Button variant="primary" icon="check" loading={acknowledge.isPending} onClick={onAcknowledge}>
                {t('alerts.acknowledge')}
              </Button>
            )}
            <Button icon="shield" loading={resolve.isPending} onClick={onResolve}>
              {t('alerts.resolve')}
            </Button>
          </div>
        </div>
      )}

      {alert.events.length > 0 && (
        <div className={s.actions}>
          <span className={uiStyles.label}>{t('alerts.timeline')}</span>
          <ol className={s.timeline}>
            {alert.events.map((event) => (
              <li key={event.id}>
                <div>
                  <strong>{tx(`alertEvents.${event.kind}`, event.kind)}</strong>
                  {event.severity && <span className="muted"> · {t(`severity.${event.severity}`)}</span>}
                  {event.actor && <span className="muted"> · {event.actor}</span>}
                </div>
                {event.note && <div className={s.eventNote}>{event.note}</div>}
                <div className={s.eventTime}>{fmt.dateTime(event.at)}</div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
