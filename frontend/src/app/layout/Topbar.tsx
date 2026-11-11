import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { useAlertSummary } from '@/features/alerts/application/hooks';
import { useAuth } from '@/features/auth/application/authContext';
import { Button, Icon } from '@/shared/ui';
import s from './layout.module.css';

function LiveClock() {
  const { t, fmt } = useI18n();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className={s.clock}>
      <Icon name="clock" size={16} />
      <span className={s.clockLabel}>{t('shell.clock')}</span>
      <span className={`${s.clockTime} ltr`}>{fmt.time(now.toISOString())}</span>
    </span>
  );
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { t, toggleLang, fmt } = useI18n();
  const { operator, logout } = useAuth();
  const summary = useAlertSummary();
  const critical = summary.data?.openCritical ?? 0;
  // Letters only: "Mousa (Admin)" -> "MA".
  const initials =
    (operator?.fullName ?? '')
      .split(/\s+/)
      .map((part) => part.replace(/[^\p{L}]/gu, ''))
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?';

  return (
    <header className={s.topbar}>
      <Button variant="ghost" size="sm" className={s.menuButton} onClick={onMenu} aria-label={t('nav.menu')}>
        <Icon name="menu" />
      </Button>
      <LiveClock />
      {critical > 0 && (
        <Link to="/alerts" className={s.criticalLink}>
          <Icon name="alert" size={15} />
          {t('shell.critical', { n: fmt.number(critical) })}
        </Link>
      )}
      <span className={s.topbarSpacer} />
      <Button variant="ghost" size="sm" icon="globe" onClick={toggleLang} aria-label={t('shell.otherLanguage')}>
        <span className={s.langLabel}>{t('shell.otherLanguage')}</span>
      </Button>
      <div className={s.user}>
        <span className={s.avatar} aria-hidden="true">
          {initials}
        </span>
        <div className={s.userText}>
          <div className={s.userName}>{operator?.fullName}</div>
          <div className={s.userRole}>{operator ? t(`settings.roles.${operator.role}`) : ''}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={logout} aria-label={t('nav.logout')} title={t('nav.logout')}>
          <Icon name="logout" flipRtl />
        </Button>
      </div>
    </header>
  );
}
