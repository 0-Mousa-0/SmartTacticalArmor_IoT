import { Link } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import type { Unit } from '@/features/units/domain/Unit';
import { Card, cx, EmptyState } from '@/shared/ui';
import { sortForOverview, unitState } from '../../domain/overviewRules';
import s from '../overview.module.css';
import { STATE_COLOR, STATE_LABEL } from './state';

/** "Field force": every unit with its state; selecting one drives the map and the readings. */
export function FieldForce({ units, selectedId, onSelect }: { units: Unit[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  const sorted = sortForOverview(units);

  return (
    <Card title={t('overview.force')} subtitle={t('overview.forceHint')} flush className={s.force}>
      <div className={s.forceBody}>
        {sorted.length === 0 ? (
          <EmptyState icon="units" title={t('overview.noUnits')} />
        ) : (
          <ul className={s.forceList}>
            {sorted.map((unit) => {
              const state = unitState(unit);
              const active = unit.id === selectedId;
              const place = unit.wearer?.zone ?? unit.wearer?.callsign ?? unit.name;
              return (
                <li key={unit.id}>
                  <button type="button" className={cx(s.forceItem, active && s.forceItemActive)} onClick={() => onSelect(unit.id)} aria-pressed={active}>
                    <span className={s.forceText}>
                      <span className={s.forceName}>{unit.wearer?.fullName ?? unit.name}</span>
                      <span className={s.forceMeta}>
                        {place} | {t(STATE_LABEL[state])}
                      </span>
                    </span>
                    <span className={s.forceSide}>
                      <span className={s.stateDot} style={{ color: STATE_COLOR[state] }} aria-hidden="true" />
                      <span className={s.code}>{unit.code}</span>
                      {unit.isSimulated && <span className={s.simTag}>{t('common.simulated')}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className={s.cardFooter}>
          <Link to="/units">{t('overview.viewAll')}</Link>
        </div>
      </div>
    </Card>
  );
}
