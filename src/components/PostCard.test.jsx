import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostCard from './PostCard';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

const basePost = {
  id: 7,
  user_id: 'author-1',
  content: 'Hello world',
  created_at: '2026-09-30T08:00:00Z',
  username: 'author',
  display_name: 'author',
  like_count: 3,
  comment_count: 2,
  liked_by_me: false,
};

describe('PostCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the author, content and counts', () => {
    renderWithProviders(<PostCard post={basePost} />);

    expect(screen.getByText('@author')).toHaveAttribute('href', '/profile/author');
    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('labels the like button according to liked_by_me', () => {
    const { unmount } = renderWithProviders(<PostCard post={basePost} />);
    expect(screen.getByRole('button', { name: 'Like post' })).toHaveAttribute('aria-pressed', 'false');
    unmount();

    renderWithProviders(<PostCard post={{ ...basePost, liked_by_me: true }} />);
    expect(screen.getByRole('button', { name: 'Unlike post' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('inserts a like and tells the parent which post changed', async () => {
    const query = createQuery({ error: null });
    supabase.from.mockReturnValue(query);
    const onChange = vi.fn();

    renderWithProviders(<PostCard post={basePost} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Like post' }));

    expect(supabase.from).toHaveBeenCalledWith('likes');
    expect(query.insert).toHaveBeenCalledWith({ post_id: 7, user_id: TEST_USER.id });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(7));
  });

  it('removes a like when the post is already liked', async () => {
    const query = createQuery({ error: null });
    supabase.from.mockReturnValue(query);

    renderWithProviders(<PostCard post={{ ...basePost, liked_by_me: true }} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Unlike post' }));

    expect(query.delete).toHaveBeenCalled();
    expect(query.match).toHaveBeenCalledWith({ post_id: 7, user_id: TEST_USER.id });
  });

  it('shows an error toast and does not notify the parent when the like fails', async () => {
    supabase.from.mockReturnValue(createQuery({ error: { message: 'boom' } }));
    const onChange = vi.fn();

    renderWithProviders(<PostCard post={basePost} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Like post' }));

    expect(await screen.findByText('Could not update like: boom')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('only shows the delete button on your own posts', () => {
    const { unmount } = renderWithProviders(<PostCard post={basePost} />);
    expect(screen.queryByRole('button', { name: 'Delete post' })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<PostCard post={{ ...basePost, user_id: TEST_USER.id }} />);
    expect(screen.getByRole('button', { name: 'Delete post' })).toBeInTheDocument();
  });

  it('deletes an own post and calls onDelete', async () => {
    const query = createQuery({ error: null });
    supabase.from.mockReturnValue(query);
    const onDelete = vi.fn();

    renderWithProviders(
      <PostCard post={{ ...basePost, user_id: TEST_USER.id }} onDelete={onDelete} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete post' }));

    expect(supabase.from).toHaveBeenCalledWith('posts');
    expect(query.eq).toHaveBeenCalledWith('id', 7);
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(7));
  });
});
