import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDataSource } from '@/app/di/dataSource';
import { useI18n } from '@/core/i18n/useI18n';
import { AlertItem } from '@/features/alerts/presentation/components/AlertItem';
import { ScenarioPanel } from '@/features/demo/presentation/ScenarioPanel';
import { toMapPoints } from '@/features/units/presentation/presenters';
import { UnitsMap } from '@/shared/map/UnitsMap';
import { Card, cx, EmptyState, ErrorState, Icon, RingGauge, Skeleton, type IconName } from '@/shared/ui';
import { useOverview } from '../application/useOverview';
import { defaultSelection, stateBreakdown, type UnitState } from '../domain/overviewRules';
import { FieldForce } from './components/FieldForce';
import { LiveReadings } from './components/LiveReadings';
import { STATE_COLOR, STATE_LABEL } from './components/state';
import { StatusBreakdown, SystemPanel } from './components/Statistics';
import s from './overview.module.css';

interface KpiProps {
  label: string;
  value: ReactNode;
  of?: string;
  hint?: ReactNode;
  icon?: IconName;
  iconColor?: string;
  gauge?: { value: number; max: number; color: string };
}

function Kpi({ label, value, of, hint, icon, iconColor, gauge }: KpiProps) {
  return (
    <div className={s.kpi}>
      <div className={s.kpiText}>
        <span className={s.kpiLabel}>{label}</span>
        <span className={s.kpiValue}>
          {value}
          {of && <span className={s.kpiOf}>{of}</span>}
        </span>
        {hint && <span className={s.kpiHint}>{hint}</span>}
      </div>
      {gauge ? (
        <RingGauge value={gauge.value} max={gauge.max} color={gauge.color} label={label} />
      ) : (
        icon && (
          <span className={s.kpiIcon} style={iconColor ? { color: iconColor } : undefined}>
            <Icon name={icon} size={20} />
          </span>
        )
      )}
    </div>
  );
}

const LEGEND: UnitState[] = ['normal', 'watch', 'critical', 'offline'];

export default function OverviewPage() {
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const simulated = useDataSource().mode === 'demo';
  const { data, isLoading, error, refetch } = useOverview();
  const [picked, setPicked] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className={s.loading}>
        <Skeleton height={110} />
        <Skeleton height={560} />
      </div>
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const units = data.units;
  const k = data.kpis;
  const selectedId = picked && units.some((unit) => unit.id === picked) ? picked : defaultSelection(units, data.priorityQueue);
  const selected = units.find((unit) => unit.id === selectedId) ?? null;
  const counts = stateBreakdown(units);
  const anyOnPost = units.some((unit) => unit.position?.source === 'post');

  return (
    <div className={s.page}>
      <header className={s.hero}>
        <div>
          <h1 className={s.title}>{t('overview.title')}</h1>
          <p className={s.subtitle}>{t('overview.subtitle')}</p>
        </div>
        <div className={s.heroMeta}>
          <span className={cx(s.livePill, simulated && s.simPill)}>
            <span className={s.liveDot} aria-hidden="true" />
            {simulated ? t('demo.modeDemo') : t('overview.live')}
          </span>
          <span>{t('common.updated', { time: fmt.time(data.generatedAt) })}</span>
        </div>
      </header>

      <section className={s.kpis} aria-label={t('overview.title')}>
        <Kpi
          label={t('overview.kpiPersonnel')}
          value={fmt.number(k.personnelAssigned)}
          hint={k.unitsSimulated ? t('overview.kpiSimulated', { n: k.unitsSimulated }) : undefined}
          icon="units"
          iconColor="var(--accent)"
        />
        <Kpi
          label={t('overview.kpiNormal')}
          value={fmt.number(counts.normal)}
          of={t('overview.ofTotal', { n: fmt.number(counts.total) })}
          gauge={{ value: counts.normal, max: counts.total, color: 'var(--accent)' }}
        />
        <Kpi
          label={t('overview.kpiCriticalAlerts')}
          value={<span style={k.alertsCritical ? { color: 'var(--critical)' } : undefined}>{fmt.number(k.alertsCritical)}</span>}
          hint={k.alertsWarning ? t('overview.kpiWarnings', { n: fmt.number(k.alertsWarning) }) : undefined}
          icon="alert"
          iconColor={k.alertsCritical ? 'var(--critical)' : undefined}
        />
        <Kpi
          label={t('overview.kpiDevices')}
          value={<span className="ltr">{fmt.number(k.unitsOnline)}</span>}
          of={t('overview.ofTotal', { n: fmt.number(k.unitsTotal) })}
          gauge={{ value: k.unitsOnline, max: k.unitsTotal, color: k.unitsOffline ? 'var(--warning)' : 'var(--accent)' }}
        />
      </section>

      <section className={s.main}>
        <FieldForce units={units} selectedId={selectedId} onSelect={setPicked} />

        <Card title={t('overview.mapTitle')} actions={<Link to="/map">{t('nav.map')}</Link>} flush className={s.mapCard}>
          <div className={s.mapBody}>
            <UnitsMap
              points={toMapPoints(units)}
              height="100%"
              selectedId={selectedId}
              onSelect={setPicked}
              showLabels
              fitToPoints
              keepInitialView
              // Only the operator's own pick moves the map: it keeps the whole force in view
              // while the highlight follows the most urgent unit.
              focusId={picked}
            />
            {anyOnPost && <span className={s.mapNote}>{t('map.postNote')}</span>}
            <div className={s.legend} aria-hidden="true">
              {LEGEND.map((state) => (
                <span key={state} className={s.legendItem}>
                  <span className={s.legendDot} style={{ background: STATE_COLOR[state] }} />
                  {t(STATE_LABEL[state])}
                </span>
              ))}
            </div>
          </div>
        </Card>

        <LiveReadings unit={selected} />
      </section>

      <section className={s.bottom}>
        <Card
          title={t('overview.eventLog')}
          actions={<Link to="/alerts">{t('overview.viewAll')}</Link>}
          flush
          className={s.log}
        >
          <div className={s.logList}>
            {data.alerts.length ? (
              data.alerts.map((alert) => <AlertItem key={alert.id} alert={alert} onSelect={() => navigate(`/alerts?focus=${alert.id}`)} />)
            ) : (
              <EmptyState icon="shield" title={t('overview.noEvents')} />
            )}
          </div>
        </Card>
        <StatusBreakdown units={units} />
        {simulated ? <ScenarioPanel className={s.system} /> : <SystemPanel health={data.system} />}
      </section>
    </div>
  );
}
