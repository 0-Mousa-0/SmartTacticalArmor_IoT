import { createContext, useContext } from 'react';
import type { ScenarioControl } from '@/features/demo/domain/scenarioControl';

/** Where the field data comes from: the real vests (via the API) or the simulation. */
export type DataSourceMode = 'live' | 'demo';

export interface DataSourceState {
  mode: DataSourceMode;
  setMode: (mode: DataSourceMode) => void;
  /** The running simulation (simulation mode only). */
  scenario: ScenarioControl | null;
}

const LIVE_ONLY: DataSourceState = { mode: 'live', setMode: () => undefined, scenario: null };

export const DataSourceContext = createContext<DataSourceState | null>(null);

export function useDataSource(): DataSourceState {
  return useContext(DataSourceContext) ?? LIVE_ONLY;
}

const STORAGE_KEY = 'sta.dataSource';
const PARAMS = ['demo', 'live'];

/** `?demo` / `?live` in the link wins, then the viewer's last choice; live by default. */
export function initialMode(search: string = window.location.search): DataSourceMode {
  const params = new URLSearchParams(search);
  if (params.has('demo')) return 'demo';
  if (params.has('live')) return 'live';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'demo' ? 'demo' : 'live';
  } catch {
    return 'live';
  }
}

/** Keep the choice for this browser; the `?demo` link only picks the start, so drop it from the address. */
export function rememberMode(mode: DataSourceMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
  const url = new URL(window.location.href);
  if (!PARAMS.some((name) => url.searchParams.has(name))) return;
  PARAMS.forEach((name) => url.searchParams.delete(name));
  window.history.replaceState(window.history.state, '', url.toString());
}
