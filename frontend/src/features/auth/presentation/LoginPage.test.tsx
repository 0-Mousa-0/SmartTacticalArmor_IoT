import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers/AppProviders';
import type { Dependencies } from '@/app/di/types';
import { tokenStore } from '@/core/auth/tokenStore';
import { ApiError } from '@/core/http/ApiError';
import type { AuthRepository } from '../domain/Operator';
import { LoginPage } from './LoginPage';

/** The API answers /auth/me with 401: sign-in is required (no public access). */
const signInRequired = () => vi.fn().mockRejectedValue(new ApiError(401, 'Missing or malformed Authorization header'));

/** Clean architecture in practice: the page runs against a fake repository. */
function renderLogin(auth: AuthRepository) {
  const dependencies = { auth } as unknown as Dependencies;
  return render(
    <AppProviders dependencies={dependencies} lang="en">
      <MemoryRouter initialEntries={['/login']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>command overview</p>} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => tokenStore.clear());

  it('signs in through the auth repository and opens the dashboard', async () => {
    const auth: AuthRepository = {
      login: vi.fn().mockResolvedValue({
        token: 'jwt',
        expiresInSeconds: 3600,
        operator: { id: 'o1', fullName: 'Duty Officer', email: 'ops@sta.test', role: 'operator', isActive: true, lastLoginAt: null, createdAt: null, isPublic: false },
      }),
      me: signInRequired(),
      changePassword: vi.fn(),
    };
    renderLogin(auth);

    await userEvent.type(await screen.findByLabelText('Email'), 'ops@sta.test');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('command overview')).toBeInTheDocument();
    expect(auth.login).toHaveBeenCalledWith('ops@sta.test', 'secret-123');
    expect(tokenStore.get()).toBe('jwt');
  });

  it('shows the server message when credentials are rejected', async () => {
    const auth: AuthRepository = {
      login: vi.fn().mockRejectedValue(new ApiError(401, 'Invalid email or password')),
      me: signInRequired(),
      changePassword: vi.fn(),
    };
    renderLogin(auth);

    await userEvent.type(await screen.findByLabelText('Email'), 'ops@sta.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(tokenStore.get()).toBeNull();
  });
});
