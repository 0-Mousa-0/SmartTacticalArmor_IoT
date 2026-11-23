import { createContext, useContext } from 'react';
import type { Operator } from '../domain/Operator';

/**
 * loading      — asking the API who we are (it may be waking up)
 * authenticated — a signed-in operator, or a public-access visitor (operator.isPublic)
 * anonymous    — the API requires sign-in
 * unreachable  — the API did not answer; retried automatically
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'unreachable';

export interface AuthState {
  status: AuthStatus;
  operator: Operator | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  retry: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error('useAuth must be used inside <AuthProvider>');
  return state;
}
