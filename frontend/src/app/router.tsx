import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '@/features/auth/presentation/LoginPage';
import { RequireAuth } from '@/features/auth/presentation/RequireAuth';
import { AppShell } from './layout/AppShell';

// Each page is its own chunk: the map and chart libraries load only when needed.
const OverviewPage = lazy(() => import('@/features/overview/presentation/OverviewPage'));
const LiveMapPage = lazy(() => import('@/features/map/presentation/LiveMapPage'));
const UnitsPage = lazy(() => import('@/features/units/presentation/UnitsPage'));
const UnitDetailPage = lazy(() => import('@/features/units/presentation/UnitDetailPage'));
const AlertsPage = lazy(() => import('@/features/alerts/presentation/AlertsPage'));
const AnalysisPage = lazy(() => import('@/features/analysis/presentation/AnalysisPage'));
const ArmorPage = lazy(() => import('@/features/armor/presentation/ArmorPage'));
const FleetPage = lazy(() => import('@/features/fleet/presentation/FleetPage'));
const SettingsPage = lazy(() => import('@/features/settings/presentation/SettingsPage'));

const ROUTER_FUTURE = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const;

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'map', element: <LiveMapPage /> },
          { path: 'units', element: <UnitsPage /> },
          { path: 'units/:id', element: <UnitDetailPage /> },
          { path: 'alerts', element: <AlertsPage /> },
          { path: 'analysis', element: <AnalysisPage /> },
          { path: 'armor', element: <ArmorPage /> },
          { path: 'fleet', element: <FleetPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
], { future: ROUTER_FUTURE });
