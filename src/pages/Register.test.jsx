import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import Register from './Register';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders } from '../test/renderWithProviders';
import { LEGAL_VERSION } from '../lib/legal';

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

const agreement = () => screen.getByRole('checkbox', { name: /I agree to the Terms of Use and the Privacy Policy/ });

async function fillForm({ username, email = 'new@example.test', password = 'secret123', agree = true }) {
  await userEvent.type(screen.getByLabelText(/username/i), username);
  await userEvent.type(screen.getByLabelText(/email/i), email);
  await userEvent.type(screen.getByLabelText(/password/i), password);
  if (agree) await userEvent.click(agreement());
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
      // and the version of the terms and the privacy policy that were accepted, which the database writes down
      options: { data: { username: 'valid_name1', accepted_legal_version: LEGAL_VERSION }, emailRedirectTo: window.location.origin },
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

      expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument();
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

  describe('the agreement to the terms and the privacy policy', () => {
    it('is a checkbox that is not ticked at first, with a link to each text that opens in a new tab', () => {
      renderRegister();

      expect(agreement()).not.toBeChecked();
      expect(agreement()).toBeRequired();
      for (const [name, href] of [['Terms of Use', '/terms'], ['Privacy Policy', '/privacy']]) {
        const link = screen.getByRole('link', { name });
        expect(link).toHaveAttribute('href', href);
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
        // inside a sentence: not only the color tells that it is a link
        expect(link.className).toMatch(/underlineAlways/);
      }
      expect(screen.getByText(/they open in a new tab/)).toBeInTheDocument();
    });

    it('stops the sign up until it is ticked: nothing is sent', async () => {
      renderRegister();
      await fillForm({ username: 'valid_name', agree: false });

      await userEvent.click(screen.getByRole('button', { name: /sign up/i }));

      expect(supabase.auth.signUp).not.toHaveBeenCalled();
    });

    it('also stops a form that is sent without the browser checking it, and says why', async () => {
      renderRegister();
      await fillForm({ username: 'valid_name', agree: false });

      fireEvent.submit(screen.getByRole('button', { name: /sign up/i }).closest('form'));

      expect(await screen.findByRole('alert')).toHaveTextContent('You need to accept the Terms of Use and the Privacy Policy');
      expect(supabase.auth.signUp).not.toHaveBeenCalled();
    });

    it('lets the sign up go through once it is ticked, and unticking it stops it again', async () => {
      supabase.auth.signUp.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
      renderRegister();
      await fillForm({ username: 'valid_name' });
      expect(agreement()).toBeChecked();

      await userEvent.click(agreement());
      fireEvent.submit(screen.getByRole('button', { name: /sign up/i }).closest('form'));
      expect(supabase.auth.signUp).not.toHaveBeenCalled();

      await userEvent.click(agreement());
      await userEvent.click(screen.getByRole('button', { name: /sign up/i }));
      await waitFor(() => expect(supabase.auth.signUp).toHaveBeenCalledTimes(1));
    });
  });

  it('has the first level heading "Create account"', () => {
    renderRegister();

    expect(screen.getByRole('heading', { level: 1, name: 'Create account' })).toBeInTheDocument();
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
