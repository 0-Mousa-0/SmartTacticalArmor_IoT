import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import type { TranslationKey } from '@/core/i18n/types';
import { useAlertSummary } from '@/features/alerts/application/hooks';
import { useAuth } from '@/features/auth/application/authContext';
import { SourceSwitch } from '@/features/demo/presentation/SourceSwitch';
import { useSystemHealth } from '@/features/system/application/useSystemHealth';
import { Button, Icon, type IconName } from '@/shared/ui';
import { useDataSource } from '../di/dataSource';
import s from './layout.module.css';

interface NavItem {
  to: string;
  label: TranslationKey;
  icon: IconName;
  end?: boolean;
  badge?: 'critical';
}

const NAV: NavItem[] = [
  { to: '/', label: 'nav.overview', icon: 'dashboard', end: true },
  { to: '/map', label: 'nav.map', icon: 'map' },
  { to: '/units', label: 'nav.units', icon: 'units' },
  { to: '/alerts', label: 'nav.alerts', icon: 'bell', badge: 'critical' },
  { to: '/analysis', label: 'nav.analysis', icon: 'brain' },
  { to: '/armor', label: 'nav.armor', icon: 'shield' },
  { to: '/fleet', label: 'nav.fleet', icon: 'fleet' },
  { to: '/settings', label: 'nav.settings', icon: 'settings' },
];

function LiveClock() {
  const { t, fmt } = useI18n();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className={s.clock} title={t('shell.clock')}>
      <Icon name="clock" size={15} />
      <span className={`${s.clockTime} ltr`}>{fmt.time(now.toISOString())}</span>
    </span>
  );
}

function LinkStatus() {
  const { t, fmt } = useI18n();
  const health = useSystemHealth();
  const mqtt = health.data?.mqtt;
  const up = Boolean(mqtt?.enabled && mqtt.connected);
  const label = up ? t('shell.linkOnline') : t('shell.linkOffline');
  // The text is hidden on most screens (only the dot shows): the tooltip always says it.
  const title = mqtt?.lastMessageAt ? `${label} · ${t('overview.lastMessage')}: ${fmt.relative(mqtt.lastMessageAt)}` : label;
  return (
    <span className={`${s.link} ${up ? s.linkUp : s.linkDown}`} title={title}>
      <span className={s.linkDot} aria-hidden="true" />
      <span className={s.linkLabel}>{label}</span>
    </span>
  );
}

function Account() {
  const { t } = useI18n();
  const { operator, logout } = useAuth();
  if (!operator) return null;
  if (operator.isPublic) {
    return (
      <span className={s.publicChip} title={t('shell.publicHint', { role: t(`settings.roles.${operator.role}`) })}>
        <Icon name="user" size={15} />
        <span className={s.publicLabel}>{t('shell.publicAccess')}</span>
      </span>
    );
  }
  // Letters only: "Mousa (Admin)" -> "MA".
  const initials =
    operator.fullName
      .split(/\s+/)
      .map((part) => part.replace(/[^\p{L}]/gu, ''))
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?';
  return (
    <div className={s.user}>
      <span className={s.avatar} aria-hidden="true" title={operator.fullName}>
        {initials}
      </span>
      <Button variant="ghost" size="sm" onClick={logout} aria-label={t('nav.logout')} title={t('nav.logout')}>
        <Icon name="logout" flipRtl />
      </Button>
    </div>
  );
}

/** One bar across the top: brand, the page menu, and live status. */
export function Topbar() {
  const { t, toggleLang, fmt } = useI18n();
  const { mode } = useDataSource();
  const summary = useAlertSummary();
  const critical = summary.data?.openCritical ?? 0;
  const [menuOpen, setMenuOpen] = useState(false);

  const links = (onNavigate?: () => void) =>
    NAV.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        className={({ isActive }) => `${s.navLink} ${isActive ? s.navActive : ''}`}
      >
        <Icon name={item.icon} size={16} className={s.navIcon} />
        <span>{t(item.label)}</span>
        {item.badge === 'critical' && critical > 0 && <span className={s.navCount}>{fmt.number(critical)}</span>}
      </NavLink>
    ));

  return (
    <header className={s.topbar}>
      <div className={s.bar}>
        <Link to="/" className={s.brand} aria-label={t('app.name')}>
          <span className={s.brandMark}>
            <Icon name="shield" size={19} />
          </span>
          <span className={s.brandText}>
            <span className={s.brandName}>{t('app.name')}</span>
            <span className={s.brandSub}>{t('app.title')}</span>
          </span>
        </Link>

        <nav className={s.nav} aria-label={t('nav.menu')}>
          {links()}
        </nav>

        <div className={s.tools}>
          {critical > 0 && (
            <Link to="/alerts" className={s.criticalLink}>
              <Icon name="alert" size={15} />
              {t('shell.critical', { n: fmt.number(critical) })}
            </Link>
          )}
          <SourceSwitch />
          {/* The real vest link says nothing about simulated data. */}
          {mode === 'live' && <LinkStatus />}
          <LiveClock />
          <Button variant="ghost" size="sm" icon="globe" onClick={toggleLang} aria-label={t('shell.otherLanguage')} className={s.langButton}>
            <span className={s.langLabel}>{t('shell.otherLanguage')}</span>
          </Button>
          <Account />
          <Button
            variant="secondary"
            size="sm"
            className={s.menuButton}
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={t('nav.menu')}
            aria-expanded={menuOpen}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} />
          </Button>
        </div>
      </div>

      {menuOpen && (
        <>
          <div className={s.overlay} onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <nav className={s.mobileNav} aria-label={t('nav.menu')}>
            {links(() => setMenuOpen(false))}
          </nav>
        </>
      )}
    </header>
  );
}
