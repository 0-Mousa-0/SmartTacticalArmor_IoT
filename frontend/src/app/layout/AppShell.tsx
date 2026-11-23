import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Skeleton } from '@/shared/ui';
import { Topbar } from './Topbar';
import s from './layout.module.css';

/** Page frame: the menu bar across the top, the page below it. */
export function AppShell() {
  return (
    <div className={s.shell}>
      <Topbar />
      <main className={s.content}>
        <Suspense fallback={<Skeleton height={320} />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
