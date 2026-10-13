import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommentSection from './CommentSection';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery, createChannel } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

const RATE_LIMIT_ERROR = {
  code: 'PT429',
  message: 'You are commenting too fast. Please wait a minute and try again.',
};

const existing = [
  { id: 1, post_id: 7, user_id: 'u1', content: 'First!', profiles: { username: 'alice' } },
  { id: 2, post_id: 7, user_id: 'u2', content: 'Nice post', profiles: { username: 'bob' } },
];

let channel;
let listQuery;
let insertQuery;

// supabase.from('comments') is used both for loading and for saving
function mockTable({ comments = existing, insertResult = { error: null } } = {}) {
  listQuery = createQuery({ data: comments, error: null });
  insertQuery = createQuery(insertResult);
  supabase.from.mockReturnValue({
    select: (...args) => listQuery.select(...args),
    insert: (...args) => insertQuery.insert(...args),
  });
}

const input = () => screen.getByRole('textbox', { name: 'Write a comment' });
const sendButton = () => screen.getByRole('button', { name: 'Send' });
const severityOf = (alert) => alert.className.match(/MuiAlert-\w*(Error|Warning)/)?.[1];

describe('CommentSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channel = createChannel();
    supabase.channel.mockReturnValue(channel);
  });

  it('lists the comments of the post with links to their authors', async () => {
    mockTable();
    renderWithProviders(<CommentSection postId={7} />);

    expect(await screen.findByText('First!')).toBeInTheDocument();
    expect(screen.getByText('Nice post')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '@alice' })).toHaveAttribute('href', '/profile/alice');
    expect(screen.getByRole('link', { name: '@bob' })).toHaveAttribute('href', '/profile/bob');
    expect(listQuery.eq).toHaveBeenCalledWith('post_id', 7);
    expect(listQuery.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it('gives the text box an accessible name (it must be on the input itself)', async () => {
    mockTable({ comments: [] });
    renderWithProviders(<CommentSection postId={7} />);

    await waitFor(() => expect(input()).toBeInTheDocument());
    expect(input().tagName).toBe('INPUT');
    expect(input()).toHaveAttribute('maxlength', '300');
  });

  it('disables Send while the box is empty or only has spaces', async () => {
    mockTable({ comments: [] });
    renderWithProviders(<CommentSection postId={7} />);

    expect(sendButton()).toBeDisabled();
    await userEvent.type(input(), '   ');
    expect(sendButton()).toBeDisabled();
    await userEvent.type(input(), 'hi');
    expect(sendButton()).toBeEnabled();
  });

  it('listens for new comments on this post only, and stops listening when closed', async () => {
    mockTable();
    const { unmount } = renderWithProviders(<CommentSection postId={7} />);
    await screen.findByText('First!');

    const [, options] = channel.on.mock.calls[0];
    expect(options).toMatchObject({ event: 'INSERT', table: 'comments', filter: 'post_id=eq.7' });

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('saves the trimmed comment as the logged-in user, clears the box and reloads the list', async () => {
    mockTable();
    renderWithProviders(<CommentSection postId={7} />);
    await screen.findByText('First!');
    const loadsBefore = listQuery.select.mock.calls.length;

    await userEvent.type(input(), '  great  ');
    await userEvent.click(sendButton());

    await waitFor(() => expect(input()).toHaveValue(''));
    expect(insertQuery.insert).toHaveBeenCalledWith({ post_id: 7, user_id: TEST_USER.id, content: 'great' });
    await waitFor(() => expect(listQuery.select.mock.calls.length).toBeGreaterThan(loadsBefore));
  });

  it('shows other errors as a red toast with an explanation, and keeps the text', async () => {
    mockTable({ insertResult: { error: { code: '42501', message: 'not allowed' } } });
    renderWithProviders(<CommentSection postId={7} />);
    await screen.findByText('First!');

    await userEvent.type(input(), 'my comment');
    await userEvent.click(sendButton());

    const toast = await screen.findByText('Could not add comment: not allowed');
    expect(severityOf(toast.closest('[role="alert"]'))).toBe('Error');
    expect(input()).toHaveValue('my comment');
  });

  describe('when the rate limit is reached', () => {
    it('shows the database message as a yellow warning, without the "Could not add" prefix', async () => {
      mockTable({ insertResult: { error: RATE_LIMIT_ERROR } });
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('First!');

      await userEvent.type(input(), 'too many');
      await userEvent.click(sendButton());

      const toast = await screen.findByText(RATE_LIMIT_ERROR.message);
      expect(severityOf(toast.closest('[role="alert"]'))).toBe('Warning');
      expect(screen.queryByText(/Could not add comment/)).not.toBeInTheDocument();
    });

    it('keeps the text so the user can send it again later', async () => {
      mockTable({ insertResult: { error: RATE_LIMIT_ERROR } });
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('First!');

      await userEvent.type(input(), 'do not lose me');
      await userEvent.click(sendButton());
      await screen.findByText(RATE_LIMIT_ERROR.message);

      expect(input()).toHaveValue('do not lose me');
      expect(sendButton()).toBeEnabled();
    });
  });
});
