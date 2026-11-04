import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import ResetPassword from './ResetPassword';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders } from '../test/renderWithProviders';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { updateUser: vi.fn() } },
}));

function renderPage(options = {}) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<div>Home page</div>} />
      <Route path="/reset-password" element={<ResetPassword />} />
    </Routes>,
    { route: '/reset-password', ...options }
  );
}

const newPassword = () => screen.getByLabelText(/^new password/i);
const repeatPassword = () => screen.getByLabelText(/^repeat new password/i);
const changeButton = () => screen.getByRole('button', { name: 'Change password' });

async function fill(first, second = first) {
  await userEvent.type(newPassword(), first);
  await userEvent.type(repeatPassword(), second);
}

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a spinner and no form while the link is still being read', () => {
    renderPage({ loading: true, user: null });

    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('Link not valid')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^new password/i)).not.toBeInTheDocument();
  });

  it('says the link is not valid when there is no session, and offers a new link', () => {
    renderPage({ user: null });

    expect(screen.getByText('Link not valid')).toBeInTheDocument();
    expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.queryByLabelText(/^new password/i)).not.toBeInTheDocument();
  });

  it('has a first level heading in both views', () => {
    const { unmount } = renderPage({ user: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Link not valid' })).toBeInTheDocument();
    unmount();

    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Choose a new password' })).toBeInTheDocument();
  });

  it('changes the password, tells the user and goes home', async () => {
    supabase.auth.updateUser.mockResolvedValue({ error: null });
    renderPage();

    await fill('brand-new-pw');
    await userEvent.click(changeButton());

    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'brand-new-pw' });
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(screen.getByText('Your password has been changed.')).toBeInTheDocument();
  });

  it('does not send anything when the two passwords differ', async () => {
    renderPage();

    await fill('first-choice', 'other-choice');
    await userEvent.click(changeButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('The passwords do not match.');
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
  });

  it('shows the error from the server and stays on the page (for example the same password again)', async () => {
    supabase.auth.updateUser.mockResolvedValue({
      error: { message: 'New password should be different from the old password.' },
    });
    renderPage();

    await fill('same-as-before');
    await userEvent.click(changeButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/should be different from the old password/i);
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
    expect(changeButton()).toBeEnabled();
  });

  it('clears an old error when the next try works', async () => {
    supabase.auth.updateUser
      .mockResolvedValueOnce({ error: { message: 'Password is too weak' } })
      .mockResolvedValueOnce({ error: null });
    renderPage();

    await fill('weakish');
    await userEvent.click(changeButton());
    await screen.findByRole('alert');
    await userEvent.click(changeButton());

    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  it('disables the button while saving, so a double click sends one request', async () => {
    let finish;
    supabase.auth.updateUser.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderPage();

    await fill('slow-save-pw');
    await userEvent.click(changeButton());
    expect(changeButton()).toBeDisabled();

    await act(async () => finish({ error: null }));
    expect(supabase.auth.updateUser).toHaveBeenCalledTimes(1);
  });

  it('asks the browser to suggest a new password, not to fill in an old one', () => {
    renderPage();

    expect(newPassword()).toHaveAttribute('autocomplete', 'new-password');
    expect(repeatPassword()).toHaveAttribute('autocomplete', 'new-password');
    expect(newPassword()).toHaveAttribute('minlength', '6');
  });
});
