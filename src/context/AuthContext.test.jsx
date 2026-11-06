import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from './AuthContext';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabaseClient';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));

// A small component that shows what the provider gives to the rest of the app
function Show() {
  const { user, session, loading, signOut } = useAuth();
  return (
    <div>
      <p>{loading ? 'loading' : 'ready'}</p>
      <p>{user ? `user ${user.email}` : 'nobody'}</p>
      <p>{session ? 'has session' : 'no session'}</p>
      <button onClick={signOut}>sign out</button>
    </div>
  );
}

const session = { user: { id: 'u-1', email: 'me@example.test' } };
let announce; // lets a test pretend that Supabase reports a login or logout
let unsubscribe;

function renderProvider() {
  return render(<AuthProvider><Show /></AuthProvider>);
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unsubscribe = vi.fn();
    supabase.auth.onAuthStateChange.mockImplementation((callback) => {
      announce = callback;
      return { data: { subscription: { unsubscribe } } };
    });
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabase.auth.signOut.mockResolvedValue({ error: null });
  });

  it('is loading until the stored session has been read', async () => {
    let finish;
    supabase.auth.getSession.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderProvider();

    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(screen.getByText('nobody')).toBeInTheDocument();

    await act(async () => finish({ data: { session } }));
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByText('user me@example.test')).toBeInTheDocument();
  });

  it('gives no user when nobody is logged in', async () => {
    renderProvider();

    expect(await screen.findByText('ready')).toBeInTheDocument();
    expect(screen.getByText('nobody')).toBeInTheDocument();
    expect(screen.getByText('no session')).toBeInTheDocument();
  });

  it('gives the user and the session of a stored login', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session } });
    renderProvider();

    expect(await screen.findByText('user me@example.test')).toBeInTheDocument();
    expect(screen.getByText('has session')).toBeInTheDocument();
  });

  it('follows logins and logouts that Supabase reports later', async () => {
    renderProvider();
    await screen.findByText('ready');

    await act(async () => announce('SIGNED_IN', session));
    expect(screen.getByText('user me@example.test')).toBeInTheDocument();

    await act(async () => announce('SIGNED_OUT', null));
    expect(screen.getByText('nobody')).toBeInTheDocument();
    expect(screen.getByText('no session')).toBeInTheDocument();
  });

  it('logs out through Supabase', async () => {
    renderProvider();
    await screen.findByText('ready');

    await userEvent.click(screen.getByRole('button', { name: 'sign out' }));

    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('stops listening when it is removed', async () => {
    const { unmount } = renderProvider();
    await screen.findByText('ready');
    expect(supabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1);

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
