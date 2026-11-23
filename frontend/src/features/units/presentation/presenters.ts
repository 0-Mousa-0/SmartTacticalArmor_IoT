import { useI18n } from '@/core/i18n/useI18n';
import type { MapPoint } from '@/shared/map/UnitsMap';
import type { RiskFactor } from '@/shared/domain/types';
import type { Unit } from '../domain/Unit';
import { unitLabel, unitState, type UnitState } from '../domain/unitRules';

/** Human-readable explanation of one AI risk factor code (e.g. "alert:FALL"). */
export function useRiskFactorText(): (factor: RiskFactor) => string {
  const { t, tx } = useI18n();
  return (factor) => {
    const [kind, arg = ''] = factor.code.split(':');
    const value = factor.detail ?? '';
    switch (kind) {
      case 'alert':
        return t('riskFactors.alert', { type: tx(`alertTypes.${arg}`, arg) });
      case 'alerts':
        return t('riskFactors.alerts', { value });
      case 'prealert':
        return t('riskFactors.prealert');
      case 'contact_lost':
        return t('riskFactors.contactLost');
      case 'posture':
        return arg === 'lying' ? t('riskFactors.postureLying') : t('riskFactors.postureBent');
      case 'immobile':
        return t('riskFactors.immobile', { value });
      case 'heat':
        return arg === 'severe' ? t('riskFactors.heatSevere', { value }) : t('riskFactors.heat', { value });
      case 'anomaly':
        return t('riskFactors.anomaly', { metric: tx(`metrics.${arg}`, arg) });
      default:
        return factor.code;
    }
  };
}

const MARKER_COLOR: Record<UnitState, string> = {
  normal: 'var(--accent)',
  watch: 'var(--warning)',
  critical: 'var(--critical)',
  offline: 'var(--offline)',
  never: 'var(--offline)',
};

/** Map markers: normal / under watch / critical / offline, as in the overview legend. */
export function toMapPoints(units: Unit[]): MapPoint[] {
  return units
    .filter((unit) => unit.position)
    .map((unit) => {
      const state = unitState(unit);
      return {
        id: unit.id,
        label: unitLabel(unit),
        lat: unit.position!.lat,
        lng: unit.position!.lng,
        color: MARKER_COLOR[state],
        status: state === 'never' ? 'offline' : state,
        approximate: unit.position!.source === 'post',
        pulse: state === 'critical',
      };
    });
}
