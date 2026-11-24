import { useDataSource } from '@/app/di/dataSource';
import { useI18n } from '@/core/i18n/useI18n';
import { Icon } from '@/shared/ui';
import s from './demo.module.css';

/** On every page while the simulation runs: nobody should mistake demo readings for real ones. */
export function DemoBanner() {
  const { t } = useI18n();
  const { mode, setMode } = useDataSource();
  if (mode !== 'demo') return null;
  return (
    <div className={s.banner} role="note">
      <div className={s.bannerInner}>
        <span className={s.bannerIcon}>
          <Icon name="activity" size={18} />
        </span>
        <p className={s.bannerText}>
          <strong>{t('demo.bannerTitle')}</strong>
          {t('demo.bannerText')}
        </p>
        <button type="button" className={s.bannerButton} onClick={() => setMode('live')}>
          {t('demo.backToLive')}
        </button>
      </div>
    </div>
  );
}
