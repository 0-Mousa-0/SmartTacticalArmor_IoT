import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { ApiError } from '@/core/http/ApiError';
import { useAlerts } from '@/features/alerts/application/hooks';
import { AlertItem } from '@/features/alerts/presentation/components/AlertItem';
import {
  Card,
  ConnectionPill,
  EmptyState,
  ErrorState,
  Icon,
  RiskBadge,
  SegmentedControl,
  SimulatedBadge,
  Skeleton,
  uiStyles,
} from '@/shared/ui';
import { useUnit } from '../application/hooks';
import type { Unit } from '../domain/Unit';
import { unitLabel } from '../domain/unitRules';
import { CommandLog, CommandPanel } from './components/CommandPanel';
import { RiskPanel } from './components/RiskPanel';
import { SensorGrid } from './components/SensorGrid';
import { TrendCharts } from './components/TrendCharts';
import s from './unitsPage.module.css';

type TimeRange = '15' | '30' | '60' | '360';

function DeviceInfo({ unit }: { unit: Unit }) {
  const { t, fmt } = useI18n();
  const w = unit.wearer;
  const sensors = Object.entries(unit.sensors)
    .filter(([, value]) => value)
    .map(([key, value]) => (typeof value === 'string' ? `${key}: ${value}` : key));
  return (
    <dl className={uiStyles.kv}>
      <dt>{t('unit.firmware')}</dt>
      <dd className="ltr">{unit.firmwareVersion ?? '—'}</dd>
      <dt>{t('unit.ip')}</dt>
      <dd className="ltr mono">{unit.ipAddress ?? '—'}</dd>
      <dt>{t('unit.interval')}</dt>
      <dd>{t('commands.everyN', { n: unit.telemetryIntervalS })}</dd>
      <dt>{t('unit.sensorsDetected')}</dt>
      <dd className="ltr">{sensors.length ? sensors.join(' · ') : '—'}</dd>
      <dt>{t('unit.wearer')}</dt>
      <dd>{w ? `${w.callsign} — ${w.fullName}${w.rank ? ` (${w.rank})` : ''}` : t('units.noWearer')}</dd>
      {w && (
        <>
          <dt>{t('unit.bloodType')}</dt>
          <dd className="ltr">{w.bloodType ?? '—'}</dd>
          <dt>{t('unit.team')}</dt>
          <dd>{w.unitName ?? '—'}</dd>
          <dt>{t('unit.zone')}</dt>
          <dd>{w.zone ?? '—'}</dd>
          <dt>{t('unit.post')}</dt>
          <dd className="ltr mono">{w.postLat !== null && w.postLng !== null ? `${fmt.number(w.postLat, 4)}, ${fmt.number(w.postLng, 4)}` : '—'}</dd>
        </>
      )}
    </dl>
  );
}

function UnitIncidents({ unitId }: { unitId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data } = useAlerts({ scope: 'open', deviceId: unitId, limit: 20 });
  if (!data || data.items.length === 0) return <EmptyState icon="shield" title={t('unit.noIncidents')} />;
  return (
    <>
      {data.items.map((alert) => (
        <AlertItem key={alert.id} alert={alert} onSelect={() => navigate(`/alerts?focus=${alert.id}`)} />
      ))}
    </>
  );
}

export default function UnitDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const { data: unit, isLoading, error, refetch } = useUnit(id);
  const [range, setRange] = useState<TimeRange>('30');

  if (isLoading) return <Skeleton height={480} />;
  if (error instanceof ApiError && error.status === 404) {
    return <EmptyState icon="units" title={t('unit.notFound')} action={<Link to="/units">{t('unit.back')}</Link>} />;
  }
  if (error || !unit) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <>
      <Link to="/units" className={s.back}>
        <Icon name="chevron" size={16} />
        {t('unit.back')}
      </Link>
      <div style={{ marginBottom: 20 }}>
        <div className={s.heading}>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>{unitLabel(unit)}</h1>
          <div className={s.badges}>
            <ConnectionPill state={unit.connection} />
            <RiskBadge level={unit.risk.level} score={unit.risk.score} />
            {unit.isSimulated && <SimulatedBadge />}
          </div>
        </div>
        <p className="muted">
          {unit.wearer?.fullName ?? t('units.noWearer')} · <span className="ltr">{unit.code}</span>
          {unit.lastSeenAt && ` · ${t('units.lastSeen', { time: fmt.relative(unit.lastSeenAt) })}`}
        </p>
      </div>

      {unit.connection === 'never' && (
        <div className={s.banner}>
          <Icon name="wifi" />
          {t('unit.neverConnected')}
        </div>
      )}

      <div className={s.layout}>
        <div className={s.column}>
          <Card title={t('unit.liveSensors')}>
            <SensorGrid unit={unit} />
          </Card>
          <Card
            title={t('unit.trends')}
            actions={
              <SegmentedControl<TimeRange>
                label={t('unit.window')}
                value={range}
                onChange={setRange}
                options={[
                  { value: '15', label: '15m' },
                  { value: '30', label: '30m' },
                  { value: '60', label: '1h' },
                  { value: '360', label: '6h' },
                ]}
              />
            }
          >
            <TrendCharts unitId={unit.id} minutes={Number(range)} />
          </Card>
          <Card title={t('unit.incidents')} flush>
            <UnitIncidents unitId={unit.id} />
          </Card>
        </div>

        <div className={s.column}>
          <Card title={t('risk.title')}>
            <RiskPanel risk={unit.risk} />
          </Card>
          <Card title={t('commands.title')}>
            <CommandPanel unit={unit} />
            <CommandLog unitId={unit.id} />
          </Card>
          <Card title={t('unit.device')}>
            <DeviceInfo unit={unit} />
          </Card>
        </div>
      </div>
    </>
  );
}
