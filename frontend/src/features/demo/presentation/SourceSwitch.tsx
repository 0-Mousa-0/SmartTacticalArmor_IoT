import { useDataSource } from '@/app/di/dataSource';
import { useI18n } from '@/core/i18n/useI18n';
import { cx } from '@/shared/ui';
import s from './demo.module.css';

/** Top-bar switch between the real vests and the simulation (DUSK-1's data-source button). */
export function SourceSwitch() {
  const { t } = useI18n();
  const { mode, setMode } = useDataSource();
  const on = mode === 'demo';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t('demo.modeDemo')}
      title={on ? t('demo.toLive') : t('demo.toDemo')}
      className={cx(s.switch, on && s.on)}
      onClick={() => setMode(on ? 'live' : 'demo')}
    >
      <span className={s.track} aria-hidden="true">
        <span className={s.thumb} />
      </span>
      <span className={s.switchLabel}>{t('demo.modeDemo')}</span>
    </button>
  );
}
