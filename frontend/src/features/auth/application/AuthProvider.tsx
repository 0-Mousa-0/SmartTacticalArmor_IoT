import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDependencies } from '@/app/di/DependenciesContext';
import { tokenStore } from '@/core/auth/tokenStore';
import { ApiError } from '@/core/http/ApiError';
import type { Operator } from '../domain/Operator';
import { AuthContext, type AuthState, type AuthStatus } from './authContext';

const RETRY_MS = 5_000;

/**
 * Session lifecycle. On start-up the API is asked who we are (/auth/me):
 * a signed-in operator, a public-access visitor (the dashboard then opens
 * without the sign-in page), or 401 = sign-in required.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth } = useDependencies();
  const queryClient = useQueryClient();
  const [operator, setOperator] = useState<Operator | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const statusRef = useRef<AuthStatus>('loading');
  const attempt = useRef(0);

  const update = useCallback((next: AuthStatus, who: Operator | null) => {
    statusRef.current = next;
    setStatus(next);
    setOperator(who);
  }, []);

  const checkSession = useCallback(async () => {
    const run = ++attempt.current;
    update('loading', null);
    const hadToken = Boolean(tokenStore.get());
    try {
      const me = await auth.me();
      if (run === attempt.current) update('authenticated', me);
    } catch (error) {
      if (run !== attempt.current) return;
      if (error instanceof ApiError && error.status === 401) {
        tokenStore.clear();
        // An expired session may still fall back to public access.
        if (hadToken) void checkSession();
        else update('anonymous', null);
      } else {
        update('unreachable', null);
      }
    }
  }, [auth, update]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  // The API can take a while to wake up (free hosting): keep trying.
  useEffect(() => {
    if (status !== 'unreachable') return;
    const timer = window.setTimeout(() => void checkSession(), RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [status, checkSession]);

  // Sign-out, or any 401 on a signed-in session (HttpClient clears the token).
  useEffect(
    () =>
      tokenStore.subscribe(() => {
        if (statusRef.current !== 'authenticated' || tokenStore.get()) return;
        queryClient.clear();
        void checkSession();
      }),
    [queryClient, checkSession],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await auth.login(email, password);
      tokenStore.set(session.token, session.expiresInSeconds);
      update('authenticated', session.operator);
    },
    [auth, update],
  );

  const logout = useCallback(() => tokenStore.clear(), []);
  const retry = useCallback(() => void checkSession(), [checkSession]);

  const value = useMemo<AuthState>(
    () => ({ status, operator, login, logout, retry }),
    [status, operator, login, logout, retry],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
