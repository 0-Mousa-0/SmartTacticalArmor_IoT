import { NavLink } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import type { TranslationKey } from '@/core/i18n/types';
import { useAlertSummary } from '@/features/alerts/application/hooks';
import { useSystemHealth } from '@/features/system/application/useSystemHealth';
import { Icon, type IconName } from '@/shared/ui';
import s from './layout.module.css';

interface NavItem {
  to: string;
  label: TranslationKey;
  icon: IconName;
  end?: boolean;
  badge?: 'critical';
}

const SECTIONS: { heading: TranslationKey; items: NavItem[] }[] = [
  {
    heading: 'nav.sectionOps',
    items: [
      { to: '/', label: 'nav.overview', icon: 'dashboard', end: true },
      { to: '/map', label: 'nav.map', icon: 'map' },
      { to: '/units', label: 'nav.units', icon: 'units' },
      { to: '/alerts', label: 'nav.alerts', icon: 'bell', badge: 'critical' },
    ],
  },
  {
    heading: 'nav.sectionIntel',
    items: [
      { to: '/analysis', label: 'nav.analysis', icon: 'brain' },
      { to: '/armor', label: 'nav.armor', icon: 'shield' },
    ],
  },
  {
    heading: 'nav.sectionAdmin',
    items: [
      { to: '/fleet', label: 'nav.fleet', icon: 'fleet' },
      { to: '/settings', label: 'nav.settings', icon: 'settings' },
    ],
  },
];

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { t, fmt } = useI18n();
  const summary = useAlertSummary();
  const health = useSystemHealth();
  const critical = summary.data?.openCritical ?? 0;
  const mqtt = health.data?.mqtt;
  const linkUp = Boolean(mqtt?.enabled && mqtt.connected);

  return (
    <aside className={`${s.sidebar} ${open ? s.sidebarOpen : ''}`} aria-label={t('nav.menu')}>
      <div className={s.brand}>
        <span className={s.brandMark}>
          <Icon name="shield" size={22} />
        </span>
        <div>
          <div className={s.brandName}>{t('app.name')}</div>
          <div className={s.brandSub}>{t('app.title')}</div>
        </div>
      </div>

      {SECTIONS.map((section) => (
        <nav key={section.heading} className={s.navSection}>
          <span className={s.navHeading}>{t(section.heading)}</span>
          {section.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) => `${s.navLink} ${isActive ? s.navActive : ''}`}
            >
              <Icon name={item.icon} />
              {t(item.label)}
              {item.badge === 'critical' && critical > 0 && <span className={s.navCount}>{fmt.number(critical)}</span>}
            </NavLink>
          ))}
        </nav>
      ))}

      <div className={s.sidebarFooter}>
        <span className={s.linkState}>
          <span className={s.linkDot} style={{ background: linkUp ? 'var(--success)' : 'var(--critical)' }} />
          {linkUp ? t('shell.linkOnline') : t('shell.linkOffline')}
        </span>
        {mqtt?.lastMessageAt && <span>{t('overview.lastMessage')}: {fmt.relative(mqtt.lastMessageAt)}</span>}
        {health.data && <span className="ltr">v{health.data.version}</span>}
      </div>
    </aside>
  );
}
