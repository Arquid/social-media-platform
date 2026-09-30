import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Feed from './Feed';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders } from '../test/renderWithProviders';
import { createQuery, createChannel, makePosts } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

// Each supabase.from() call returns the next prepared query
function queueQueries(...queries) {
  const queue = [...queries];
  supabase.from.mockImplementation(() => queue.shift());
}

describe('Feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.channel.mockReturnValue(createChannel());
  });

  it('shows the empty state when there are no posts', async () => {
    queueQueries(createQuery({ data: [], error: null }));
    renderWithProviders(<Feed />);

    expect(await screen.findByText('No posts yet.')).toBeInTheDocument();
  });

  it('shows an error message when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    queueQueries(createQuery({ data: null, error: { message: 'network down' } }));
    renderWithProviders(<Feed />);

    expect(await screen.findByText(/could not load posts: network down/i)).toBeInTheDocument();
  });

  it('does not show "Load more" when everything fits on one page', async () => {
    queueQueries(createQuery({ data: makePosts(5), error: null }));
    renderWithProviders(<Feed />);

    expect(await screen.findByText('Post 5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('loads the first page of 20 newest posts', async () => {
    const first = createQuery({ data: makePosts(20, 50), error: null });
    queueQueries(first);
    renderWithProviders(<Feed />);

    expect(await screen.findByText('Post 50')).toBeInTheDocument();
    expect(screen.getByText('Post 31')).toBeInTheDocument();
    expect(supabase.from).toHaveBeenCalledWith('posts_feed');
    expect(first.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(first.limit).toHaveBeenCalledWith(20);
    expect(first.lt).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
  });

  it('loads older posts with a cursor and hides the button on the last page', async () => {
    const first = createQuery({ data: makePosts(20, 50), error: null });
    const second = createQuery({ data: makePosts(5, 30), error: null });
    queueQueries(first, second);
    renderWithProviders(<Feed />);

    await screen.findByText('Post 31');
    await userEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(await screen.findByText('Post 26')).toBeInTheDocument();
    // The cursor is the id of the oldest post that was on screen
    expect(second.lt).toHaveBeenCalledWith('id', 31);
    expect(screen.getAllByText(/^Post \d+$/)).toHaveLength(25);
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('does not show the same post twice if a page overlaps', async () => {
    const first = createQuery({ data: makePosts(20, 50), error: null });
    // Overlaps with the first page on ids 31 and 30
    const second = createQuery({ data: makePosts(3, 31), error: null });
    queueQueries(first, second);
    renderWithProviders(<Feed />);

    await screen.findByText('Post 31');
    await userEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(await screen.findByText('Post 29')).toBeInTheDocument();
    expect(screen.getAllByText('Post 31')).toHaveLength(1);
    expect(screen.getAllByText(/^Post \d+$/)).toHaveLength(22);
  });

  it('shows a toast and keeps the list when "Load more" fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = createQuery({ data: makePosts(20, 50), error: null });
    const second = createQuery({ data: null, error: { message: 'timeout' } });
    queueQueries(first, second);
    renderWithProviders(<Feed />);

    await screen.findByText('Post 31');
    await userEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(await screen.findByText('Could not load more posts: timeout')).toBeInTheDocument();
    expect(screen.getAllByText(/^Post \d+$/)).toHaveLength(20);
    expect(screen.getByRole('button', { name: /load more/i })).toBeEnabled();
  });

  it('filters the feed by author on a profile page', async () => {
    const query = createQuery({ data: makePosts(2), error: null });
    queueQueries(query);
    renderWithProviders(<Feed authorId="author-1" />);

    await screen.findByText('Post 2');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'author-1');
  });

  it('shows nothing extra when the user follows nobody', async () => {
    const follows = createQuery({ data: [], error: null });
    queueQueries(follows);
    renderWithProviders(<Feed followingOnly />);

    expect(await screen.findByText('No posts yet.')).toBeInTheDocument();
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('follows');
  });

  it('only loads posts from followed users on the Following tab', async () => {
    const follows = createQuery({ data: [{ following_id: 'author-1' }], error: null });
    const posts = createQuery({ data: makePosts(2), error: null });
    queueQueries(follows, posts);
    renderWithProviders(<Feed followingOnly />);

    await screen.findByText('Post 2');
    expect(posts.in).toHaveBeenCalledWith('user_id', ['author-1']);
  });

  it('unsubscribes from realtime when it unmounts', async () => {
    queueQueries(createQuery({ data: makePosts(1), error: null }));
    const { unmount } = renderWithProviders(<Feed />);

    await screen.findByText('Post 1');
    expect(supabase.channel).toHaveBeenCalled();
    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });
});
