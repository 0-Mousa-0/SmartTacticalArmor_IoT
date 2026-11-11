import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { useAuth } from '../application/authContext';

/** Route guard: only signed-in operators reach the dashboard. */
export function RequireAuth() {
  const { status } = useAuth();
  const { t } = useI18n();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>
        {t('common.loading')}
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
