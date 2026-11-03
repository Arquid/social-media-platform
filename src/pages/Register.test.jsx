import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import Register from './Register';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders } from '../test/renderWithProviders';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { signUp: vi.fn() } },
}));

function renderRegister() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<div>Home page</div>} />
      <Route path="/register" element={<Register />} />
    </Routes>,
    { user: null, route: '/register' }
  );
}

async function fillForm({ username, email = 'new@example.test', password = 'secret123' }) {
  await userEvent.type(screen.getByLabelText(/username/i), username);
  await userEvent.type(screen.getByLabelText(/email/i), email);
  await userEvent.type(screen.getByLabelText(/password/i), password);
}

describe('Register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['ab', 'too short'],
    ['has space', 'contains a space'],
    ['bad!name', 'contains a special character'],
    ['a'.repeat(21), 'too long'],
  ])('rejects username "%s" (%s)', async (username) => {
    renderRegister();
    await fillForm({ username });

    expect(screen.getByText(/username must be 3-20 characters/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });

  it('lowercases and trims the username before signing up, then goes home', async () => {
    supabase.auth.signUp.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    renderRegister();
    await fillForm({ username: ' Valid_Name1 ' });

    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));

    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'new@example.test',
      password: 'secret123',
      // The confirmation link, if the project sends one, must come back to this app
      options: { data: { username: 'valid_name1' }, emailRedirectTo: window.location.origin },
    });
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  describe('when the project requires email confirmation (sign up gives no session)', () => {
    async function signUpWithoutSession() {
      supabase.auth.signUp.mockResolvedValue({ data: { session: null, user: { id: 'new-user' } }, error: null });
      renderRegister();
      await fillForm({ username: 'valid_name', email: 'confirm@example.test' });
      await userEvent.click(screen.getByRole('button', { name: /sign up/i }));
    }

    it('asks the user to check their email instead of going home', async () => {
      await signUpWithoutSession();

      expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
      expect(screen.getByText(/confirmation link to confirm@example.test/i)).toBeInTheDocument();
      expect(screen.queryByText('Home page')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login');
    });

    it('does not show the form again, so the account is not created twice', async () => {
      await signUpWithoutSession();

      await screen.findByRole('heading', { name: 'Check your email' });
      expect(screen.queryByRole('button', { name: /sign up/i })).not.toBeInTheDocument();
      expect(supabase.auth.signUp).toHaveBeenCalledTimes(1);
    });
  });

  it('tells password managers which field is which', () => {
    renderRegister();

    expect(screen.getByLabelText(/username/i)).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('autocomplete', 'new-password');
  });

  it('turns the database error for a taken username into a friendly message', async () => {
    supabase.auth.signUp.mockResolvedValue({
      error: { message: 'Database error saving new user' },
    });
    renderRegister();
    await fillForm({ username: 'taken_name' });

    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));

    expect(await screen.findByText(/username is already taken/i)).toBeInTheDocument();
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
  });

  it('shows other sign up errors as they are', async () => {
    supabase.auth.signUp.mockResolvedValue({ error: { message: 'Password is too weak' } });
    renderRegister();
    await fillForm({ username: 'valid_name' });

    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => expect(screen.getByText('Password is too weak')).toBeInTheDocument());
  });
});
