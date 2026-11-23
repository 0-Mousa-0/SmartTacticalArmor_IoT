import type { TranslationKey } from '@/core/i18n/types';
import type { IconName } from '@/shared/ui';
import type { UnitState } from '../../domain/overviewRules';

/** One look per unit state, shared by the list, the legend and the statistics. */
export const STATE_COLOR: Record<UnitState, string> = {
  critical: 'var(--critical)',
  watch: 'var(--warning)',
  normal: 'var(--accent)',
  offline: 'var(--offline)',
  never: 'var(--offline)',
};

export const STATE_LABEL: Record<UnitState, TranslationKey> = {
  critical: 'overview.stateCritical',
  watch: 'overview.stateWatch',
  normal: 'overview.stateNormal',
  offline: 'overview.stateOffline',
  never: 'overview.stateNever',
};

export const STATE_ICON: Record<UnitState, IconName> = {
  critical: 'alert',
  watch: 'bell',
  normal: 'shield',
  offline: 'close',
  never: 'close',
};
