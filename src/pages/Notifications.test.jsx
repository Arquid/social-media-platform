import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Notifications from './Notifications';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery, createChannel } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

const notifications = [
  { id: 3, type: 'follow', post_id: null, read: false, created_at: '2026-09-30T10:00:00Z', actor: { username: 'carol' } },
  { id: 2, type: 'comment', post_id: 9, read: false, created_at: '2026-09-30T09:00:00Z', actor: { username: 'bob' } },
  { id: 1, type: 'like', post_id: 7, read: true, created_at: '2026-09-30T08:00:00Z', actor: { username: 'bob' } },
];

let channel;
let listQuery;
let markReadQuery;

// 1st call lists the notifications, 2nd call marks them as read
function mockNotifications(rows = notifications) {
  listQuery = createQuery({ data: rows, error: null });
  markReadQuery = createQuery({ error: null });
  supabase.from.mockReturnValueOnce(listQuery).mockReturnValueOnce(markReadQuery);
}

// The user name is bold and the rest is plain text, so look the row up by its link name
const row = (text) => screen.findByRole('link', { name: new RegExp(text) });

function renderPage() {
  return renderWithProviders(<Notifications />);
}

describe('Notifications page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channel = createChannel();
    supabase.channel.mockReturnValue(channel);
  });

  it('shows an empty state when there are no notifications', async () => {
    mockNotifications([]);
    renderPage();

    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
  });

  it('has a first level heading for screen readers, with and without notifications', async () => {
    mockNotifications();
    const { unmount } = renderPage();
    await row('@bob liked your post');
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
    unmount();

    mockNotifications([]);
    renderPage();
    await screen.findByText('No notifications yet.');
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
  });

  it('describes each notification', async () => {
    mockNotifications();
    renderPage();

    expect(await row('@bob liked your post')).toBeInTheDocument();
    expect(await row('@bob commented on your post')).toBeInTheDocument();
    expect(await row('@carol started following you')).toBeInTheDocument();
  });

  it('shows when each notification happened in words, with the exact time as a tooltip', async () => {
    // Only the date is faked, so the timers of the page keep working
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
    try {
      mockNotifications([
        { id: 3, type: 'follow', post_id: null, read: false, created_at: new Date(2026, 5, 15, 11, 55).toISOString(), actor: { username: 'carol' } },
        { id: 2, type: 'comment', post_id: 9, read: false, created_at: new Date(2026, 5, 13, 12, 0).toISOString(), actor: { username: 'bob' } },
        { id: 1, type: 'like', post_id: 7, read: true, created_at: new Date(2025, 11, 19, 8, 0).toISOString(), actor: { username: 'bob' } },
      ]);
      renderPage();

      expect(await row('@carol started following you.*5 minutes ago')).toBeInTheDocument();
      expect(await row('@bob commented on your post.*2 days ago')).toBeInTheDocument();
      expect(await row('@bob liked your post.*Dec 19, 2025')).toBeInTheDocument();
      expect(screen.getByText('5 minutes ago').closest('time')).toHaveAttribute('title');
    } finally {
      vi.useRealTimers();
    }
  });

  it('links likes and comments to the post', async () => {
    mockNotifications();
    renderPage();

    expect(await screen.findByRole('link', { name: /@bob liked your post/ })).toHaveAttribute('href', '/post/7');
    expect(screen.getByRole('link', { name: /@bob commented on your post/ })).toHaveAttribute('href', '/post/9');
  });

  it('links a follow notification to the follower\'s profile', async () => {
    mockNotifications();
    renderPage();

    expect(await screen.findByRole('link', { name: /@carol started following you/ })).toHaveAttribute(
      'href',
      '/profile/carol'
    );
  });

  it('loads the newest 20 notifications of the logged-in user', async () => {
    mockNotifications();
    renderPage();
    await row('@bob liked your post');

    expect(supabase.from).toHaveBeenNthCalledWith(1, 'notifications');
    expect(listQuery.eq).toHaveBeenCalledWith('user_id', TEST_USER.id);
    expect(listQuery.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(listQuery.limit).toHaveBeenCalledWith(20);
  });

  it('marks everything as read after showing the list', async () => {
    mockNotifications();
    renderPage();
    await row('@bob liked your post');

    await waitFor(() => expect(markReadQuery.update).toHaveBeenCalledWith({ read: true }));
    expect(markReadQuery.eq).toHaveBeenCalledWith('user_id', TEST_USER.id);
    expect(markReadQuery.eq).toHaveBeenCalledWith('read', false);
  });

  it('adds a new notification when it arrives, asking only for newer ones', async () => {
    mockNotifications([notifications[2]]);
    renderPage();
    await row('@bob liked your post');

    const newer = createQuery({ data: [notifications[0], notifications[1]], error: null });
    supabase.from.mockReturnValueOnce(newer);
    const [, options, callback] = channel.on.mock.calls[0];
    expect(options).toMatchObject({ event: 'INSERT', table: 'notifications', filter: `user_id=eq.${TEST_USER.id}` });
    await act(async () => callback());

    expect(await row('@carol started following you')).toBeInTheDocument();
    expect(newer.gt).toHaveBeenCalledWith('id', 1);
    expect(newer.limit).not.toHaveBeenCalled();
  });

  describe('pages', () => {
    // newest first, the newest having the id `newest`
    const many = (count, newest) =>
      Array.from({ length: count }, (_, i) => ({
        id: newest - i, type: 'like', post_id: 7, read: true,
        created_at: '2026-09-30T08:00:00Z', actor: { username: `fan${newest - i}` },
      }));
    const names = () => screen.getAllByRole('link').map((link) => link.textContent.split(' ')[0]);
    const loadMoreButton = () => screen.queryByRole('button', { name: 'Load more' });

    it('offers more only when the first page was full', async () => {
      mockNotifications(many(19, 19));
      const { unmount } = renderPage();
      await screen.findByText('@fan19');
      expect(loadMoreButton()).not.toBeInTheDocument();
      unmount();

      mockNotifications(many(20, 20));
      renderPage();
      await screen.findByText('@fan20');
      expect(loadMoreButton()).toBeInTheDocument();
    });

    it('loads the 20 below the oldest notification on the screen, and hides the button on the last page', async () => {
      mockNotifications(many(20, 40));
      renderPage();
      await screen.findByText('@fan40');
      const next = createQuery({ data: many(5, 20), error: null });
      supabase.from.mockReturnValueOnce(next);

      await userEvent.click(loadMoreButton());

      expect(await screen.findByText('@fan16')).toBeInTheDocument();
      expect(next.lt).toHaveBeenCalledWith('id', 21);
      expect(next.limit).toHaveBeenCalledWith(20);
      expect(next.eq).toHaveBeenCalledWith('user_id', TEST_USER.id);
      expect(names()).toHaveLength(25);
      expect(names()[24]).toBe('@fan16');
      expect(loadMoreButton()).not.toBeInTheDocument();
    });

    it('keeps the button when the next page is full as well', async () => {
      mockNotifications(many(20, 60));
      renderPage();
      await screen.findByText('@fan60');
      supabase.from.mockReturnValueOnce(createQuery({ data: many(20, 40), error: null }));

      await userEvent.click(loadMoreButton());
      await screen.findByText('@fan21');

      expect(loadMoreButton()).toBeInTheDocument();
    });

    it('shows nothing twice when pages overlap', async () => {
      mockNotifications(many(20, 40));
      renderPage();
      await screen.findByText('@fan40');
      supabase.from.mockReturnValueOnce(createQuery({ data: many(3, 21), error: null }));

      await userEvent.click(loadMoreButton());
      await screen.findByText('@fan19');

      expect(screen.getAllByText('@fan21')).toHaveLength(1);
      expect(names()).toHaveLength(22);
    });

    it('shows a toast and keeps the list when the next page cannot be loaded', async () => {
      mockNotifications(many(20, 40));
      renderPage();
      await screen.findByText('@fan40');
      supabase.from.mockReturnValueOnce(createQuery({ data: null, error: { message: 'network down' } }));

      await userEvent.click(loadMoreButton());

      expect(await screen.findByText('Could not load more notifications: network down')).toBeInTheDocument();
      expect(names()).toHaveLength(20);
      expect(loadMoreButton()).toBeEnabled();
    });

    it('disables the button and says so while the next page is on its way', async () => {
      mockNotifications(many(20, 40));
      renderPage();
      await screen.findByText('@fan40');
      let answer;
      supabase.from.mockReturnValueOnce(createQuery(new Promise((resolve) => { answer = resolve; })));

      await userEvent.click(loadMoreButton());
      expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled();

      await act(async () => answer({ data: many(2, 20), error: null }));
      expect(await screen.findByText('@fan19')).toBeInTheDocument();
    });

    it('puts new notifications above the old ones, also after more have been loaded', async () => {
      mockNotifications(many(20, 40));
      renderPage();
      await screen.findByText('@fan40');
      supabase.from.mockReturnValueOnce(createQuery({ data: many(5, 20), error: null }));
      await userEvent.click(loadMoreButton());
      await screen.findByText('@fan16');

      const newer = createQuery({ data: many(2, 42), error: null });
      supabase.from.mockReturnValueOnce(newer);
      const [, , callback] = channel.on.mock.calls[0];
      await act(async () => callback());

      expect(await screen.findByText('@fan42')).toBeInTheDocument();
      expect(newer.gt).toHaveBeenCalledWith('id', 40);
      expect(names().slice(0, 3)).toEqual(['@fan42', '@fan41', '@fan40']);
      expect(names()).toHaveLength(27);
    });

    it('starts from the first page when the first notification arrives', async () => {
      mockNotifications([]);
      renderPage();
      await screen.findByText('No notifications yet.');
      const first = createQuery({ data: many(1, 1), error: null });
      supabase.from.mockReturnValueOnce(first);

      const [, , callback] = channel.on.mock.calls[0];
      await act(async () => callback());

      expect(await screen.findByText('@fan1')).toBeInTheDocument();
      expect(first.gt).not.toHaveBeenCalled();
      expect(first.limit).toHaveBeenCalledWith(20);
    });
  });

  it('unsubscribes when the page is closed', async () => {
    mockNotifications();
    const { unmount } = renderPage();
    await row('@bob liked your post');

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });
});
