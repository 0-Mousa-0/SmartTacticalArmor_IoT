import { useI18n } from '@/core/i18n/useI18n';
import type { Risk } from '@/shared/domain/types';
import { RISK_COLOR } from '@/shared/ui';
import { useRiskFactorText } from '../presenters';
import s from './panels.module.css';

/** Explainable AI risk: the score and every factor that produced it. */
export function RiskPanel({ risk }: { risk: Risk }) {
  const { t, fmt } = useI18n();
  const factorText = useRiskFactorText();
  const color = RISK_COLOR[risk.level];
  return (
    <div className={s.risk}>
      <div className={s.ring} style={{ background: `conic-gradient(${color} ${risk.score * 3.6}deg, var(--surface-3) 0deg)` }}>
        <div className={s.ringInner}>
          <span className={s.ringScore} style={{ color }}>
            {risk.score}
          </span>
          <span className={s.ringLevel}>{t(`risk.${risk.level}`)}</span>
        </div>
      </div>
      <div className={s.factors}>
        <span className={s.factorsTitle}>{t('risk.factors')}</span>
        {risk.factors.length === 0 ? (
          <p className="muted">{t('risk.noFactors')}</p>
        ) : (
          <ul>
            {risk.factors.map((factor) => (
              <li key={factor.code}>
                <span>{factorText(factor)}</span>
                <strong className="num">+{factor.points}</strong>
              </li>
            ))}
          </ul>
        )}
        {risk.updatedAt && <span className={s.updated}>{t('common.updated', { time: fmt.time(risk.updatedAt) })}</span>}
      </div>
    </div>
  );
}
