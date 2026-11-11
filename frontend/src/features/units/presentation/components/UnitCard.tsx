import { Link } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { Badge, ConnectionPill, Icon, RISK_COLOR, RiskBadge, RiskMeter, SimulatedBadge } from '@/shared/ui';
import type { Unit } from '../../domain/Unit';
import { unitLabel } from '../../domain/unitRules';
import s from './units.module.css';

export function UnitCard({ unit }: { unit: Unit }) {
  const { t, tx, fmt } = useI18n();
  const telemetry = unit.telemetry;
  return (
    <Link to={`/units/${unit.id}`} className={s.card} style={{ borderTopColor: RISK_COLOR[unit.risk.level] }}>
      <div className={s.cardTop}>
        <div>
          <div className={s.callsign}>{unitLabel(unit)}</div>
          <div className={s.sub}>
            {unit.wearer?.fullName ?? t('units.noWearer')} · <span className="ltr">{unit.code}</span>
          </div>
        </div>
        <ConnectionPill state={unit.connection} />
      </div>

      <div className={s.riskLine}>
        <RiskMeter level={unit.risk.level} score={unit.risk.score} />
        <RiskBadge level={unit.risk.level} score={unit.risk.score} />
      </div>

      <div className={s.metrics}>
        <span title={t('sensors.vestTemp')}>
          <Icon name="thermometer" size={15} />
          <span className="num">{fmt.number(telemetry?.vestTempC, 1)}</span>°C
        </span>
        <span title={t('sensors.posture')}>
          <Icon name="posture" size={15} />
          {telemetry?.posture ? t(`posture.${telemetry.posture}`) : '—'}
        </span>
        <span title={t('sensors.activity')}>
          <Icon name="activity" size={15} />
          <span className="num">{fmt.number(telemetry?.activityG, 2)}</span>g
        </span>
      </div>

      <div className={s.cardBottom}>
        <div className={s.chips}>
          {unit.isSimulated && <SimulatedBadge />}
          {unit.openAlerts.slice(0, 2).map((alert) => (
            <Badge key={alert.id} tone={alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'info'}>
              {tx(`alertTypes.${alert.type}`, alert.type)}
            </Badge>
          ))}
          {unit.openAlerts.length > 2 && <Badge>+{unit.openAlerts.length - 2}</Badge>}
        </div>
        <span className={s.seen}>{unit.lastSeenAt ? t('units.lastSeen', { time: fmt.relative(unit.lastSeenAt) }) : t('connection.never')}</span>
      </div>
    </Link>
  );
}
