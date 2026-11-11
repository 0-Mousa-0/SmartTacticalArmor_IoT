import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import type { AlertSource, Severity } from '@/shared/domain/types';
import { Card, EmptyState, ErrorState, PageHeader, SegmentedControl, Skeleton, uiStyles } from '@/shared/ui';
import { useAlert, useAlerts } from '../application/hooks';
import { AlertDetail } from './AlertDetail';
import { AlertItem } from './components/AlertItem';
import s from './alertsPage.module.css';

type Tab = 'open' | 'closed';

export default function AlertsPage() {
  const { t, fmt } = useI18n();
  const [params, setParams] = useSearchParams();
  const focus = params.get('focus');
  const [tab, setTab] = useState<Tab>('open');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [source, setSource] = useState<AlertSource | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(focus);

  useEffect(() => {
    if (focus) setSelectedId(focus);
  }, [focus]);

  const list = useAlerts({ scope: tab, severity: severity || undefined, source: source || undefined, limit: 100 });
  const detail = useAlert(selectedId);

  const select = (id: string) => {
    setSelectedId(id);
    setParams({ focus: id }, { replace: true });
  };

  return (
    <>
      <PageHeader title={t('alerts.title')} subtitle={t('alerts.subtitle')} />
      <div className={s.toolbar}>
        <SegmentedControl<Tab>
          label={t('alerts.title')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'open', label: t('alerts.tabActive') },
            { value: 'closed', label: t('alerts.tabHistory') },
          ]}
        />
        <div className={s.filters}>
          <select className={uiStyles.select} value={severity} onChange={(e) => setSeverity(e.target.value as Severity | '')} aria-label={t('alerts.severity')}>
            <option value="">
              {t('alerts.severity')}: {t('common.all')}
            </option>
            {(['critical', 'warning', 'info'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`severity.${value}`)}
              </option>
            ))}
          </select>
          <select className={uiStyles.select} value={source} onChange={(e) => setSource(e.target.value as AlertSource | '')} aria-label={t('alerts.source')}>
            <option value="">
              {t('alerts.source')}: {t('common.all')}
            </option>
            <option value="device">{t('alertSource.device')}</option>
            <option value="analysis">{t('alertSource.analysis')}</option>
          </select>
        </div>
      </div>

      <div className={s.layout}>
        <Card
          title={t('alerts.count', { n: fmt.number(list.data?.total ?? 0) })}
          flush
          className={s.list}
        >
          {list.isLoading ? (
            <div style={{ padding: 16 }}>
              <Skeleton height={300} />
            </div>
          ) : list.error ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : list.data && list.data.items.length > 0 ? (
            list.data.items.map((alert) => (
              <AlertItem key={alert.id} alert={alert} selected={alert.id === selectedId} onSelect={() => select(alert.id)} />
            ))
          ) : (
            <EmptyState icon="shield" title={t('alerts.empty')} />
          )}
        </Card>

        <Card className={s.detail}>
          {!selectedId ? (
            <EmptyState icon="bell" title={t('alerts.selectHint')} />
          ) : detail.isLoading ? (
            <Skeleton height={260} />
          ) : detail.error || !detail.data ? (
            <ErrorState error={detail.error} />
          ) : (
            <AlertDetail key={detail.data.id} alert={detail.data} />
          )}
        </Card>
      </div>
    </>
  );
}
