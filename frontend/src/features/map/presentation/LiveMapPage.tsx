import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { useUnits } from '@/features/units/application/hooks';
import { sortByPriority, unitLabel } from '@/features/units/domain/unitRules';
import { toMapPoints } from '@/features/units/presentation/presenters';
import { UnitsMap } from '@/shared/map/UnitsMap';
import { Card, ConnectionPill, ErrorState, Icon, PageHeader, RiskBadge, Skeleton } from '@/shared/ui';
import s from './map.module.css';

export default function LiveMapPage() {
  const { t, fmt } = useI18n();
  const { data, isLoading, error, refetch } = useUnits();
  const [selected, setSelected] = useState<string | null>(null);
  const units = useMemo(() => sortByPriority(data ?? []), [data]);

  if (isLoading) return <Skeleton height={560} />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const current = units.find((unit) => unit.id === selected);

  return (
    <>
      <PageHeader title={t('map.title')} subtitle={t('map.subtitle')} />
      <div className={s.layout}>
        <Card flush className={s.mapCard}>
          <UnitsMap points={toMapPoints(units)} height="100%" selectedId={selected} onSelect={setSelected} zoom={11} showLabels />
          <p className={s.note}>
            <Icon name="pin" size={14} /> {t('map.postNote')}
          </p>
        </Card>

        <Card title={t('map.units')} flush className={s.side}>
          {current && (
            <div className={s.selected}>
              <div className={s.selectedTitle}>
                <strong>{unitLabel(current)}</strong>
                <RiskBadge level={current.risk.level} score={current.risk.score} />
              </div>
              <span className="muted">{current.wearer?.fullName ?? t('units.noWearer')}</span>
              <span className="muted">
                {current.wearer?.zone ?? '—'} · {current.position?.source === 'gps' ? t('sensors.gpsFix') : t('sensors.post')}
              </span>
              <Link to={`/units/${current.id}`}>{t('common.details')} →</Link>
            </div>
          )}
          <ul className={s.list}>
            {units.map((unit) => (
              <li key={unit.id}>
                <button type="button" className={`${s.row} ${unit.id === selected ? s.rowActive : ''}`} onClick={() => setSelected(unit.id)}>
                  <span className={s.rowName}>
                    <strong>{unitLabel(unit)}</strong>
                    <span className="muted">{unit.lastSeenAt ? fmt.relative(unit.lastSeenAt) : t('connection.never')}</span>
                  </span>
                  <span className={s.rowSide}>
                    <RiskBadge level={unit.risk.level} />
                    <ConnectionPill state={unit.connection} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
