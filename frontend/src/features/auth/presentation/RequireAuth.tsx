import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../application/authContext';
import { SessionSplash } from './SessionSplash';

/**
 * Route guard. In public-access mode the API itself lets visitors in, so the
 * dashboard opens directly; the sign-in page is only used when the API asks for it.
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading' || status === 'unreachable') return <SessionSplash />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
