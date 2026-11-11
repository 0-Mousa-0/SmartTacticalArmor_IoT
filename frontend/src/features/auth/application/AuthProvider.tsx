import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDependencies } from '@/app/di/DependenciesContext';
import { tokenStore } from '@/core/auth/tokenStore';
import type { Operator } from '../domain/Operator';
import { AuthContext, type AuthState, type AuthStatus } from './authContext';

/** Session lifecycle: restore on load, sign in, sign out, react to expiry. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth } = useDependencies();
  const queryClient = useQueryClient();
  const [operator, setOperator] = useState<Operator | null>(null);
  const [status, setStatus] = useState<AuthStatus>(() => (tokenStore.get() ? 'loading' : 'anonymous'));

  // Restore an existing session (token in storage) once on start-up.
  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    auth
      .me()
      .then((me) => {
        if (cancelled) return;
        setOperator(me);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        tokenStore.clear();
        setStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  // Any 401 clears the token (HttpClient) -> drop to the login screen.
  useEffect(
    () =>
      tokenStore.subscribe(() => {
        if (!tokenStore.get()) {
          setOperator(null);
          setStatus('anonymous');
          queryClient.clear();
        }
      }),
    [queryClient],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await auth.login(email, password);
      tokenStore.set(session.token, session.expiresInSeconds);
      setOperator(session.operator);
      setStatus('authenticated');
    },
    [auth],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    setOperator(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthState>(() => ({ status, operator, login, logout }), [status, operator, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
