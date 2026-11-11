import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { AlertItem } from '@/features/alerts/presentation/components/AlertItem';
import type { SystemHealth } from '@/features/system/domain/SystemHealth';
import type { Unit } from '@/features/units/domain/Unit';
import { UnitRiskRow } from '@/features/units/presentation/components/UnitRiskRow';
import { toMapPoints } from '@/features/units/presentation/presenters';
import { UnitsMap } from '@/shared/map/UnitsMap';
import { Badge, Card, EmptyState, ErrorState, Icon, PageHeader, Skeleton, StatTile, RISK_COLOR } from '@/shared/ui';
import { useOverview } from '../application/useOverview';
import s from './overview.module.css';

function SystemStatus({ health }: { health: SystemHealth }) {
  const { t, fmt } = useI18n();
  const mqtt = health.mqtt;
  return (
    <dl className={s.status}>
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
  );
}

export default function OverviewPage() {
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useOverview();

  if (isLoading) {
    return (
      <div className={s.loading}>
        <Skeleton height={110} />
        <Skeleton height={420} />
      </div>
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const byId = new Map(data.units.map((unit) => [unit.id, unit]));
  const queue = data.priorityQueue.map((id) => byId.get(id)).filter((unit): unit is Unit => Boolean(unit));
  const k = data.kpis;
  const avgLevel = k.riskAverage >= 75 ? 'critical' : k.riskAverage >= 50 ? 'high' : k.riskAverage >= 20 ? 'elevated' : 'normal';

  return (
    <>
      <PageHeader
        title={t('overview.title')}
        subtitle={t('overview.subtitle')}
        actions={<span className="muted">{t('common.updated', { time: fmt.time(data.generatedAt) })}</span>}
      />

      <div className={s.kpis}>
        <StatTile
          icon="units"
          label={t('overview.kpiOnline')}
          value={<span className="ltr">{`${k.unitsOnline}/${k.unitsTotal}`}</span>}
          hint={k.unitsSimulated ? t('overview.kpiSimulated', { n: k.unitsSimulated }) : undefined}
          color={k.unitsOffline ? 'var(--warning)' : 'var(--success)'}
        />
        <StatTile icon="alert" label={t('overview.kpiCritical')} value={fmt.number(k.alertsCritical)} color={k.alertsCritical ? 'var(--critical)' : undefined} />
        <StatTile icon="bell" label={t('overview.kpiWarning')} value={fmt.number(k.alertsWarning)} color={k.alertsWarning ? 'var(--warning)' : undefined} />
        <StatTile icon="clock" label={t('overview.kpiPending')} value={fmt.number(k.alertsPending)} />
        <StatTile icon="brain" label={t('overview.kpiRisk')} value={fmt.number(k.riskAverage)} color={RISK_COLOR[avgLevel]} hint={`max ${k.riskMax}`} />
      </div>

      <div className={s.grid}>
        <Card title={t('overview.priorityQueue')} subtitle={t('overview.priorityHint')} flush className={s.queue}>
          {queue.length ? queue.map((unit, index) => <UnitRiskRow key={unit.id} unit={unit} rank={index + 1} />) : <EmptyState title={t('common.noData')} />}
        </Card>

        <Card
          title={t('overview.incidents')}
          actions={<Link to="/alerts">{t('overview.viewAll')}</Link>}
          flush
          className={s.incidents}
        >
          {data.alerts.length ? (
            data.alerts.map((alert) => <AlertItem key={alert.id} alert={alert} onSelect={() => navigate(`/alerts?focus=${alert.id}`)} />)
          ) : (
            <EmptyState icon="shield" title={t('overview.noIncidents')} />
          )}
        </Card>

        <Card title={t('overview.map')} actions={<Link to="/map">{t('nav.map')}</Link>} flush className={s.map}>
          <UnitsMap points={toMapPoints(data.units)} height={340} onSelect={(id) => navigate(`/units/${id}`)} zoom={10} />
        </Card>

        <Card title={t('overview.system')} className={s.system}>
          <SystemStatus health={data.system} />
        </Card>
      </div>
    </>
  );
}
