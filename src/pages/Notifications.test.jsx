import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
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

  it('describes each notification', async () => {
    mockNotifications();
    renderPage();

    expect(await row('@bob liked your post')).toBeInTheDocument();
    expect(await row('@bob commented on your post')).toBeInTheDocument();
    expect(await row('@carol started following you')).toBeInTheDocument();
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

  it('loads the newest 50 notifications of the logged-in user', async () => {
    mockNotifications();
    renderPage();
    await row('@bob liked your post');

    expect(supabase.from).toHaveBeenNthCalledWith(1, 'notifications');
    expect(listQuery.eq).toHaveBeenCalledWith('user_id', TEST_USER.id);
    expect(listQuery.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(listQuery.limit).toHaveBeenCalledWith(50);
  });

  it('marks everything as read after showing the list', async () => {
    mockNotifications();
    renderPage();
    await row('@bob liked your post');

    await waitFor(() => expect(markReadQuery.update).toHaveBeenCalledWith({ read: true }));
    expect(markReadQuery.eq).toHaveBeenCalledWith('user_id', TEST_USER.id);
    expect(markReadQuery.eq).toHaveBeenCalledWith('read', false);
  });

  it('reloads the list when a new notification arrives', async () => {
    mockNotifications([notifications[2]]);
    renderPage();
    await row('@bob liked your post');

    supabase.from.mockReturnValueOnce(createQuery({ data: notifications, error: null }));
    const [, options, callback] = channel.on.mock.calls[0];
    expect(options).toMatchObject({ event: 'INSERT', table: 'notifications', filter: `user_id=eq.${TEST_USER.id}` });
    await act(async () => callback());

    expect(await row('@carol started following you')).toBeInTheDocument();
  });

  it('unsubscribes when the page is closed', async () => {
    mockNotifications();
    const { unmount } = renderPage();
    await row('@bob liked your post');

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });
});
