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
    supabase.auth.signUp.mockResolvedValue({ error: null });
    renderRegister();
    await fillForm({ username: ' Valid_Name1 ' });

    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));

    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'new@example.test',
      password: 'secret123',
      options: { data: { username: 'valid_name1' } },
    });
    expect(await screen.findByText('Home page')).toBeInTheDocument();
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
