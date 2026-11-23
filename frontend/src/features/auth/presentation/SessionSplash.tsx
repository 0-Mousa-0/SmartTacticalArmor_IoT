import { useI18n } from '@/core/i18n/useI18n';
import { Button, Icon } from '@/shared/ui';
import { useAuth } from '../application/authContext';
import s from './login.module.css';

/** Shown while the dashboard asks the API who we are, or while the API wakes up. */
export function SessionSplash() {
  const { t } = useI18n();
  const { status, retry } = useAuth();
  const unreachable = status === 'unreachable';
  return (
    <div className={s.page}>
      <div className={s.splash} role="status" aria-live="polite">
        <span className={s.mark}>
          <Icon name="shield" size={28} />
        </span>
        <p className={s.splashTitle}>{t('app.name')}</p>
        {unreachable ? (
          <>
            <p className={s.subtitle}>{t('session.unreachable')}</p>
            <Button variant="secondary" size="sm" icon="refresh" onClick={retry}>
              {t('common.retry')}
            </Button>
          </>
        ) : (
          <>
            <span className={s.spinner} aria-hidden="true" />
            <p className={s.subtitle}>{t('session.connecting')}</p>
          </>
        )}
      </div>
    </div>
  );
}
