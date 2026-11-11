import { Link } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { ConnectionPill, RiskBadge, RiskMeter, SimulatedBadge } from '@/shared/ui';
import type { Unit } from '../../domain/Unit';
import { unitLabel } from '../../domain/unitRules';
import { useRiskFactorText } from '../presenters';
import s from './units.module.css';

/** One row of the AI priority queue: who, how risky, and why. */
export function UnitRiskRow({ unit, rank }: { unit: Unit; rank: number }) {
  const { t } = useI18n();
  const factorText = useRiskFactorText();
  const topFactor = unit.risk.factors[0];
  return (
    <Link to={`/units/${unit.id}`} className={s.riskRow}>
      <span className={s.rank}>{rank}</span>
      <div className={s.riskRowMain}>
        <div className={s.riskRowTitle}>
          <strong>{unitLabel(unit)}</strong>
          <span className="muted">{unit.wearer?.fullName ?? t('units.noWearer')}</span>
          {unit.isSimulated && <SimulatedBadge />}
        </div>
        <RiskMeter level={unit.risk.level} score={unit.risk.score} />
        <span className={s.reason}>{topFactor ? factorText(topFactor) : t('risk.noFactors')}</span>
      </div>
      <div className={s.riskRowSide}>
        <RiskBadge level={unit.risk.level} score={unit.risk.score} />
        <ConnectionPill state={unit.connection} />
      </div>
    </Link>
  );
}
