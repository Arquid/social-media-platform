import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import Login from './Login';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders } from '../test/renderWithProviders';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: vi.fn() } },
}));

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<div>Home page</div>} />
      <Route path="/login" element={<Login />} />
    </Routes>,
    { user: null, route: '/login' }
  );
}

const logInButton = () => screen.getByRole('button', { name: 'Log in' });

async function fillAndSubmit(email = 'me@example.test', password = 'secret123') {
  await userEvent.type(screen.getByLabelText(/^email/i), email);
  await userEvent.type(screen.getByLabelText(/^password/i), password);
  await userEvent.click(logInButton());
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs in with the given email and password and goes home', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: null });
    renderLogin();

    await fillAndSubmit();

    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'me@example.test',
      password: 'secret123',
    });
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  it('shows the error and stays on the page when the login fails', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    renderLogin();

    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
    expect(logInButton()).toBeEnabled();
  });

  it('disables the button while logging in', async () => {
    let finish;
    supabase.auth.signInWithPassword.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderLogin();

    await fillAndSubmit();
    expect(logInButton()).toBeDisabled();

    await act(async () => finish({ error: null }));
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('does not send anything while the fields are empty', async () => {
    renderLogin();

    await userEvent.click(logInButton());

    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('links to the password reset and to the sign up page', () => {
    renderLogin();

    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register');
  });

  it('tells password managers which field is which', () => {
    renderLogin();

    // A login form names the email field "username": that is how password managers find it
    expect(screen.getByLabelText(/^email/i)).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText(/^password/i)).toHaveAttribute('autocomplete', 'current-password');
  });
});
