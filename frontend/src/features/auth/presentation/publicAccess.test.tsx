import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dependencies } from '@/app/di/types';
import { AppProviders } from '@/app/providers/AppProviders';
import { tokenStore } from '@/core/auth/tokenStore';
import { ApiError } from '@/core/http/ApiError';
import type { AuthRepository, Operator } from '../domain/Operator';
import { LoginPage } from './LoginPage';
import { RequireAuth } from './RequireAuth';

const visitor: Operator = {
  id: '',
  fullName: 'Public access',
  email: '',
  role: 'admin',
  isActive: true,
  lastLoginAt: null,
  createdAt: null,
  isPublic: true,
};

function renderApp(auth: AuthRepository, path = '/') {
  const dependencies = { auth } as unknown as Dependencies;
  return render(
    <AppProviders dependencies={dependencies} lang="en">
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<p>command overview</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

const fakeAuth = (me: AuthRepository['me']): AuthRepository => ({ login: vi.fn(), me, changePassword: vi.fn() });

describe('public access (no sign-in)', () => {
  beforeEach(() => tokenStore.clear());

  it('opens the dashboard directly when the API allows public access', async () => {
    const auth = fakeAuth(vi.fn().mockResolvedValue(visitor));
    renderApp(auth);
    expect(await screen.findByText('command overview')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('sends /login straight to the dashboard in public mode', async () => {
    renderApp(fakeAuth(vi.fn().mockResolvedValue(visitor)), '/login');
    expect(await screen.findByText('command overview')).toBeInTheDocument();
  });

  it('still shows the sign-in page when the API requires it', async () => {
    renderApp(fakeAuth(vi.fn().mockRejectedValue(new ApiError(401, 'Missing or malformed Authorization header'))));
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });

  it('waits for a sleeping server instead of asking to sign in', async () => {
    const me = vi.fn().mockRejectedValueOnce(new ApiError(0, 'timeout')).mockResolvedValue(visitor);
    renderApp(fakeAuth(me));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('command overview')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });
});
