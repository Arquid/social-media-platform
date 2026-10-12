import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostCard from './PostCard';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders } from '../test/renderWithProviders';
import { createQuery } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  },
}));

vi.mock('./CommentSection', () => ({ default: () => null }));

// Distinct numbers, so a counter can be found by its text
const basePost = {
  id: 7,
  user_id: 'author-1',
  content: 'Hello',
  created_at: '2026-09-30T08:00:00Z',
  username: 'author',
  display_name: 'author',
  avatar_path: null,
  like_count: 4,
  comment_count: 8,
  liked_by_me: false,
};

const likedPost = { ...basePost, like_count: 5, liked_by_me: true };

// A promise that is settled by the test, to control when "the server" answers
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Behaves like the real Feed/PostPage: it owns the post and replaces it when onChange is called
function Host({ start = basePost, refresh }) {
  const [post, setPost] = useState(start);
  return <PostCard post={post} onChange={async () => setPost(await refresh())} />;
}

const likeButton = () => screen.getByRole('button', { name: 'Like post' });
const unlikeButton = () => screen.getByRole('button', { name: 'Unlike post' });

describe('PostCard: optimistic like', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the like and the new count immediately, before the server has answered', async () => {
    const request = deferred();
    supabase.from.mockReturnValue(createQuery(request.promise));
    renderWithProviders(<Host refresh={async () => likedPost} />);

    await userEvent.click(likeButton());

    // The request is still open, but the screen already shows the result
    expect(unlikeButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByText('4')).not.toBeInTheDocument();

    await act(async () => request.resolve({ error: null }));
    expect(unlikeButton()).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('keeps the optimistic number until the fresh post has arrived (no flicker)', async () => {
    supabase.from.mockReturnValue(createQuery({ error: null }));
    const fresh = deferred();
    renderWithProviders(<Host refresh={() => fresh.promise} />);

    await userEvent.click(likeButton());

    // The request is done, but the refreshed post is still on its way
    expect(unlikeButton()).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    await act(async () => fresh.resolve(likedPost));
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('does not count the like twice when the fresh post arrives before the request is finished', async () => {
    supabase.from.mockReturnValue(createQuery({ error: null }));
    const hold = deferred(); // keeps the "saving" state open after the parent has the fresh post
    function SlowHost() {
      const [post, setPost] = useState(basePost);
      return (
        <PostCard
          post={post}
          onChange={async () => {
            setPost(likedPost);
            await hold.promise;
          }}
        />
      );
    }
    renderWithProviders(<SlowHost />);

    await userEvent.click(likeButton());

    // The parent already has the post with the like (5). It must not become 6.
    expect(await screen.findByText('5')).toBeInTheDocument();
    expect(screen.queryByText('6')).not.toBeInTheDocument();
    expect(unlikeButton()).toBeInTheDocument();

    await act(async () => hold.resolve());
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('adds the like on top of other people\'s likes that arrive while saving', async () => {
    const request = deferred();
    supabase.from.mockReturnValue(createQuery(request.promise));
    function LiveHost() {
      const [post, setPost] = useState(basePost);
      return (
        <>
          <button onClick={() => setPost({ ...basePost, like_count: 6 })}>someone else likes</button>
          <PostCard post={post} />
        </>
      );
    }
    renderWithProviders(<LiveHost />);

    await userEvent.click(likeButton());
    expect(screen.getByText('5')).toBeInTheDocument();

    // A realtime update from another person: 4 -> 6 likes. My own like comes on top: 7.
    await userEvent.click(screen.getByRole('button', { name: 'someone else likes' }));
    expect(screen.getByText('7')).toBeInTheDocument();

    await act(async () => request.resolve({ error: null }));
  });

  it('undoes the change and shows a toast when saving fails', async () => {
    const request = deferred();
    supabase.from.mockReturnValue(createQuery(request.promise));
    const refresh = vi.fn();
    renderWithProviders(<Host refresh={refresh} />);

    await userEvent.click(likeButton());
    expect(screen.getByText('5')).toBeInTheDocument();

    await act(async () => request.resolve({ error: { message: 'boom' } }));

    expect(await screen.findByText('Could not update like: boom')).toBeInTheDocument();
    // The toast appears a moment before React drops the optimistic change, so wait for it
    expect(await screen.findByRole('button', { name: 'Like post' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled(); // nothing changed, so there is nothing to reload
  });

  it('can be tried again after a failure', async () => {
    supabase.from
      .mockReturnValueOnce(createQuery({ error: { message: 'boom' } }))
      .mockReturnValueOnce(createQuery({ error: null }));
    renderWithProviders(<Host refresh={async () => likedPost} />);

    await userEvent.click(likeButton());
    await screen.findByText('Could not update like: boom');
    // Wait until the failed attempt is fully over (the button is back to "Like post")
    await userEvent.click(await screen.findByRole('button', { name: 'Like post' }));
    expect(await screen.findByRole('button', { name: 'Unlike post' })).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });

  it('unliking also shows the result immediately', async () => {
    const request = deferred();
    supabase.from.mockReturnValue(createQuery(request.promise));
    renderWithProviders(<Host start={likedPost} refresh={async () => basePost} />);

    await userEvent.click(unlikeButton());

    expect(likeButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText('5')).not.toBeInTheDocument();

    await act(async () => request.resolve({ error: null }));
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('sends only one request when the button is clicked again before the first one is saved', async () => {
    const request = deferred();
    supabase.from.mockReturnValue(createQuery(request.promise));
    renderWithProviders(<Host refresh={async () => likedPost} />);

    await userEvent.click(likeButton());
    await userEvent.click(unlikeButton());
    await userEvent.click(unlikeButton());

    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(screen.getByText('5')).toBeInTheDocument();

    await act(async () => request.resolve({ error: null }));
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('accepts a new click once the previous one is finished', async () => {
    supabase.from.mockReturnValue(createQuery({ error: null }));
    let current = likedPost;
    renderWithProviders(<Host refresh={async () => current} />);

    await userEvent.click(likeButton());
    expect(await screen.findByRole('button', { name: 'Unlike post' })).toBeInTheDocument();

    current = basePost;
    await userEvent.click(unlikeButton());
    expect(await screen.findByRole('button', { name: 'Like post' })).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });

  it('does not touch the comment counter', async () => {
    supabase.from.mockReturnValue(createQuery(deferred().promise));
    renderWithProviders(<Host refresh={async () => likedPost} />);

    await userEvent.click(likeButton());

    expect(screen.getByText('8')).toBeInTheDocument();
  });
});
