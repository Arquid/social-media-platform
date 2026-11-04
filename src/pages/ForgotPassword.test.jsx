import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForgotPassword from './ForgotPassword';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders } from '../test/renderWithProviders';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { resetPasswordForEmail: vi.fn() } },
}));

const sendButton = () => screen.getByRole('button', { name: 'Send link' });

async function request(email = 'lost@example.test') {
  await userEvent.type(screen.getByLabelText(/email/i), email);
  await userEvent.click(sendButton());
}

describe('ForgotPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has a first level heading in both views', async () => {
    supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    renderWithProviders(<ForgotPassword />, { user: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Forgot your password?' })).toBeInTheDocument();

    await request();

    expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument();
  });

  it('asks the email provider for a link that comes back to the reset page of this app', async () => {
    supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    renderWithProviders(<ForgotPassword />, { user: null });

    await request();

    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('lost@example.test', {
      redirectTo: `${window.location.origin}/reset-password`,
    });
  });

  it('says only that a link was sent if an account exists, so it does not reveal who has an account', async () => {
    supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    renderWithProviders(<ForgotPassword />, { user: null });

    await request();

    expect(await screen.findByText(/if an account exists for lost@example.test/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it('shows the error and keeps the form when sending fails (for example a rate limit)', async () => {
    supabase.auth.resetPasswordForEmail.mockResolvedValue({
      error: { message: 'For security purposes, you can only request this after 60 seconds.' },
    });
    renderWithProviders(<ForgotPassword />, { user: null });

    await request();

    expect(await screen.findByRole('alert')).toHaveTextContent(/only request this after 60 seconds/i);
    expect(screen.getByLabelText(/email/i)).toHaveValue('lost@example.test');
    expect(screen.queryByText(/if an account exists/i)).not.toBeInTheDocument();
  });

  it('disables the button while the request is on its way', async () => {
    let finish;
    supabase.auth.resetPasswordForEmail.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderWithProviders(<ForgotPassword />, { user: null });

    await request();
    expect(sendButton()).toBeDisabled();

    await act(async () => finish({ error: null }));
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it('does not send anything without an email address', async () => {
    renderWithProviders(<ForgotPassword />, { user: null });

    await userEvent.click(sendButton());

    expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('lets the email be filled in by the browser, and links back to the login page', () => {
    renderWithProviders(<ForgotPassword />, { user: null });

    expect(screen.getByLabelText(/email/i)).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login');
  });
});
