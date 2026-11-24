import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { DemoBanner } from '@/features/demo/presentation/DemoBanner';
import { Skeleton } from '@/shared/ui';
import { useDataSource } from '../di/dataSource';
import { Topbar } from './Topbar';
import s from './layout.module.css';

/** Page frame: the menu bar across the top, the page below it. */
export function AppShell() {
  const { mode } = useDataSource();
  return (
    // Switching between live data and the simulation starts every page afresh.
    <div className={s.shell} key={mode}>
      <Topbar />
      <DemoBanner />
      <main className={s.content}>
        <Suspense fallback={<Skeleton height={320} />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
