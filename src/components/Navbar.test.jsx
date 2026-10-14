import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import Navbar from './Navbar';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery, createChannel } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

let channel;

// One answer serves both lookups of the navbar: the username and the unread count
function mockLookups({ username = 'me', unread = 0 } = {}) {
  supabase.from.mockReturnValue(createQuery({ data: { username }, count: unread, error: null }));
}

describe('Navbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channel = createChannel();
    supabase.channel.mockReturnValue(channel);
    mockLookups();
  });

  describe('for a logged-in user', () => {
    it('links to the feed from the app name', () => {
      renderWithProviders(<Navbar />);

      expect(screen.getByRole('link', { name: 'Socialy' })).toHaveAttribute('href', '/');
    });

    it('has a search button that opens the search page', () => {
      renderWithProviders(<Navbar />);

      expect(screen.getByRole('link', { name: 'Search users' })).toHaveAttribute('href', '/search');
    });

    it('links to the own profile once the username is known', async () => {
      mockLookups({ username: 'anna' });
      renderWithProviders(<Navbar />);

      expect(await screen.findByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile/anna');
    });

    it('links to the notifications, with no number when everything is read', async () => {
      renderWithProviders(<Navbar />);

      expect(await screen.findByRole('link', { name: 'Profile' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '/notifications');
    });

    it('tells the number of unread notifications in the label', async () => {
      mockLookups({ unread: 3 });
      renderWithProviders(<Navbar />);

      expect(await screen.findByRole('link', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('counts only the unread notifications of this user', async () => {
      renderWithProviders(<Navbar />);
      await screen.findByRole('link', { name: 'Profile' });

      const notificationQuery = supabase.from.mock.results[0].value;
      expect(supabase.from).toHaveBeenCalledWith('notifications');
      expect(notificationQuery.eq).toHaveBeenCalledWith('user_id', TEST_USER.id);
      expect(notificationQuery.eq).toHaveBeenCalledWith('read', false);
    });

    it('has a log out button', () => {
      renderWithProviders(<Navbar />);

      expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
    });

    it('listens for this user\'s notifications and stops listening when removed', async () => {
      const { unmount } = renderWithProviders(<Navbar />);
      await screen.findByRole('link', { name: 'Profile' });

      const [, options] = channel.on.mock.calls[0];
      expect(options).toMatchObject({ table: 'notifications', filter: `user_id=eq.${TEST_USER.id}` });

      unmount();
      expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
    });
  });

  describe('for a visitor who is not logged in', () => {
    it('only offers logging in', () => {
      renderWithProviders(<Navbar />, { user: null });

      expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
      expect(screen.queryByRole('link', { name: 'Search users' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Notifications/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
    });

    it('does not ask the database for anything', () => {
      renderWithProviders(<Navbar />, { user: null });

      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.channel).not.toHaveBeenCalled();
    });
  });
});
