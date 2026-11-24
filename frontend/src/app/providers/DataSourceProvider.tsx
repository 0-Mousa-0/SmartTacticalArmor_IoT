import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DemoSession } from '@/features/demo/data/DemoSession';
import type { ScenarioControl } from '@/features/demo/domain/scenarioControl';
import { createDemoDependencies, createDemoSession } from '../di/container';
import { DataSourceContext, initialMode, rememberMode, type DataSourceMode, type DataSourceState } from '../di/dataSource';
import { DependenciesContext } from '../di/DependenciesContext';
import type { Dependencies } from '../di/types';

/**
 * Live or simulation, like DUSK-1's data-source button: the pages read the
 * same repository interfaces either way, only what stands behind them changes.
 */
export function DataSourceProvider({ live, children }: { live: Dependencies; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<DemoSession | null>(() => (initialMode() === 'demo' ? createDemoSession(live) : null));
  const mode: DataSourceMode = session ? 'demo' : 'live';

  useEffect(() => rememberMode(mode), [mode]);

  const setMode = useCallback(
    (next: DataSourceMode) => {
      if (next === mode) return;
      // Nothing cached from one source may show up under the other.
      void queryClient.cancelQueries();
      queryClient.clear();
      setSession(next === 'demo' ? createDemoSession(live) : null);
    },
    [mode, live, queryClient],
  );

  const scenario = useMemo<ScenarioControl | null>(
    () =>
      session && {
        status: () => session.status(),
        restart: () => {
          session.restart();
          void queryClient.invalidateQueries();
        },
      },
    [session, queryClient],
  );

  const dependencies = useMemo(() => (session ? createDemoDependencies(live, session) : live), [session, live]);
  const state = useMemo<DataSourceState>(() => ({ mode, setMode, scenario }), [mode, setMode, scenario]);

  return (
    <DataSourceContext.Provider value={state}>
      <DependenciesContext.Provider value={dependencies}>{children}</DependenciesContext.Provider>
    </DataSourceContext.Provider>
  );
}
