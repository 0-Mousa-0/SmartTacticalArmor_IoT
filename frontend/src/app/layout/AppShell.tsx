import { Suspense, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Skeleton } from '@/shared/ui';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import s from './layout.module.css';

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className={s.shell}>
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className={s.overlay} onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <div className={s.main}>
        <Topbar onMenu={() => setMenuOpen(true)} />
        <main className={s.content}>
          <Suspense fallback={<Skeleton height={320} />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
