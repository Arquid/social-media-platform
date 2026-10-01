import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import PostPage from './PostPage';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery, createChannel } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

// The comment section has its own tests; here it is only a placeholder
vi.mock('../components/CommentSection', () => ({
  default: ({ postId }) => <div>Comments of post {postId}</div>,
}));

const post = {
  id: 7,
  user_id: 'author-1',
  content: 'A post to open',
  created_at: '2026-09-30T08:00:00Z',
  username: 'author',
  display_name: 'author',
  avatar_path: null,
  like_count: 4,
  comment_count: 8,
  liked_by_me: false,
};

let channel;

// Returns a different posts_feed query result on every call; other tables succeed silently
function mockPosts(...results) {
  const queue = [...results];
  supabase.from.mockImplementation((table) =>
    table === 'posts_feed' ? createQuery(queue.shift() ?? results.at(-1)) : createQuery({ error: null })
  );
}

const postsFeedCalls = () => supabase.from.mock.calls.filter(([table]) => table === 'posts_feed').length;

function renderPage(id = '7') {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<div>Home page</div>} />
      <Route path="/post/:id" element={<PostPage />} />
    </Routes>,
    { route: `/post/${id}` }
  );
}

// Fires a realtime event the same way the Supabase client would
function emit(table, event, payload) {
  const [, , callback] = channel.on.mock.calls.find(([, options]) => options.table === table && (options.event === event || options.event === '*'));
  return act(async () => callback(payload));
}

describe('PostPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channel = createChannel();
    supabase.channel.mockReturnValue(channel);
  });

  it('shows the post with its comments already open', async () => {
    mockPosts({ data: post, error: null });
    renderPage();

    expect(await screen.findByText('A post to open')).toBeInTheDocument();
    expect(screen.getByText('@author')).toBeInTheDocument();
    expect(screen.getByText('Comments of post 7')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide comments' })).toBeInTheDocument();
  });

  it('asks the database for exactly this post', async () => {
    mockPosts({ data: post, error: null });
    renderPage();

    await screen.findByText('A post to open');
    expect(supabase.from).toHaveBeenCalledWith('posts_feed');
    const query = supabase.from.mock.results[0].value;
    expect(query.eq).toHaveBeenCalledWith('id', '7');
    expect(query.maybeSingle).toHaveBeenCalled();
  });

  it('shows a spinner while loading', () => {
    mockPosts({ data: post, error: null });
    renderPage();

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it.each(['abc', '12abc', '-5', '1.5'])('shows "not found" for the invalid id "%s" without asking the database', (id) => {
    renderPage(id);

    expect(screen.getByText(/does not exist or has been deleted/i)).toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('renders the "not found" message without React warnings and centered', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage('abc');

    expect(consoleError).not.toHaveBeenCalled();
    const message = screen.getByText(/does not exist or has been deleted/i);
    expect(message.parentElement).toHaveStyle({ alignItems: 'center' });
  });

  it('shows "not found" and a way back when the post does not exist', async () => {
    mockPosts({ data: null, error: null });
    renderPage('99999');

    expect(await screen.findByText(/does not exist or has been deleted/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to the feed' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  it('shows an error message when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPosts({ data: null, error: { message: 'network down' } });
    renderPage();

    expect(await screen.findByText(/could not load the post: network down/i)).toBeInTheDocument();
  });

  it('reloads the post after you like it, so the counter is correct', async () => {
    mockPosts({ data: post, error: null }, { data: { ...post, like_count: 5, liked_by_me: true }, error: null });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Like post' }));

    expect(await screen.findByRole('button', { name: 'Unlike post' })).toBeInTheDocument();
    expect(postsFeedCalls()).toBe(2);
  });

  it('goes home after you delete your own post', async () => {
    mockPosts({ data: { ...post, user_id: TEST_USER.id }, error: null });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete post' }));

    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  describe('real-time updates', () => {
    it('reloads when someone likes or unlikes this post', async () => {
      mockPosts({ data: post, error: null }, { data: { ...post, like_count: 5 }, error: null });
      renderPage();
      await screen.findByText('A post to open');

      await emit('likes', 'INSERT', { new: { post_id: 7, user_id: 'x' }, old: {} });

      await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
      expect(postsFeedCalls()).toBe(2);
    });

    it('also reloads on an unlike (the event only has the old row)', async () => {
      mockPosts({ data: post, error: null });
      renderPage();
      await screen.findByText('A post to open');

      await emit('likes', 'DELETE', { new: {}, old: { post_id: 7, user_id: 'x' } });

      await waitFor(() => expect(postsFeedCalls()).toBe(2));
    });

    it('ignores likes on other posts', async () => {
      mockPosts({ data: post, error: null });
      renderPage();
      await screen.findByText('A post to open');

      await emit('likes', 'INSERT', { new: { post_id: 8, user_id: 'x' }, old: {} });

      expect(postsFeedCalls()).toBe(1);
    });

    it('reloads when a comment is added to this post, but not to another', async () => {
      mockPosts({ data: post, error: null }, { data: { ...post, comment_count: 9 }, error: null });
      renderPage();
      await screen.findByText('A post to open');

      await emit('comments', 'INSERT', { new: { post_id: 99 } });
      expect(postsFeedCalls()).toBe(1);

      await emit('comments', 'INSERT', { new: { post_id: 7 } });
      await waitFor(() => expect(screen.getByText('9')).toBeInTheDocument());
    });

    it('shows "not found" when this post is deleted by someone else', async () => {
      mockPosts({ data: post, error: null });
      renderPage();
      await screen.findByText('A post to open');

      await emit('posts', 'DELETE', { old: { id: 7 } });

      expect(await screen.findByText(/does not exist or has been deleted/i)).toBeInTheDocument();
      expect(screen.queryByText('A post to open')).not.toBeInTheDocument();
    });

    it('ignores the deletion of other posts', async () => {
      mockPosts({ data: post, error: null });
      renderPage();
      await screen.findByText('A post to open');

      await emit('posts', 'DELETE', { old: { id: 8 } });

      expect(screen.getByText('A post to open')).toBeInTheDocument();
    });

    it('unsubscribes when the page is closed', async () => {
      mockPosts({ data: post, error: null });
      const { unmount } = renderPage();
      await screen.findByText('A post to open');

      expect(supabase.removeChannel).not.toHaveBeenCalled();
      unmount();
      expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
    });
  });
});
