import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommentSection from './CommentSection';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery, createChannel } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: `http://storage.test/${p}` } }) }) },
  },
}));

const RATE_LIMIT_ERROR = {
  code: 'PT429',
  message: 'You are commenting too fast. Please wait a minute and try again.',
};

// Newest first, like the database sends them
const existing = [
  { id: 2, post_id: 7, user_id: 'u2', content: 'Nice post', profiles: { username: 'bob' } },
  { id: 1, post_id: 7, user_id: 'u1', content: 'First!', profiles: { username: 'alice' } },
];

// `count` comments, newest first, the newest having the id `newest`
const makeComments = (count, newest) =>
  Array.from({ length: count }, (_, i) => ({
    id: newest - i, post_id: 7, user_id: 'u1', content: `Comment ${newest - i}`, profiles: { username: 'alice' },
  }));

let channel;
let listQuery;
let insertQuery;
let deleteQuery;

// supabase.from('comments') is used for loading, saving and deleting
function mockTable({ comments = existing, insertResult = { error: null }, deleteResult = { error: null } } = {}) {
  listQuery = createQuery({ data: comments, error: null });
  insertQuery = createQuery(insertResult);
  deleteQuery = createQuery(deleteResult);
  supabase.from.mockReturnValue({
    select: (...args) => listQuery.select(...args),
    insert: (...args) => insertQuery.insert(...args),
    delete: (...args) => deleteQuery.delete(...args),
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
    // Inside a sentence a link must not rely on color alone: it is underlined
    expect(screen.getByRole('link', { name: '@alice' }).className).toMatch(/underlineAlways/);
    expect(listQuery.eq).toHaveBeenCalledWith('post_id', 7);
    // The newest 20, by id (the id grows with time and is unique, so pages never overlap)
    expect(listQuery.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(listQuery.limit).toHaveBeenCalledWith(20);
  });

  it('shows the newest comment first, below the box where a new one is written', async () => {
    mockTable();
    renderWithProviders(<CommentSection postId={7} />);

    const newest = await screen.findByText('Nice post');
    const oldest = screen.getByText('First!');
    expect(newest.compareDocumentPosition(oldest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input().compareDocumentPosition(newest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the avatar of the author next to each comment, and asks for it', async () => {
    mockTable({
      comments: [
        { ...existing[0], profiles: { username: 'bob', avatar_path: 'u2/me.png' } },
        { ...existing[1], profiles: { username: 'alice', avatar_path: null } },
      ],
    });
    renderWithProviders(<CommentSection postId={7} />);

    expect(await screen.findByAltText("bob's avatar")).toHaveAttribute('src', 'http://storage.test/u2/me.png');
    // Without a picture the first letter of the name is shown instead
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(listQuery.select).toHaveBeenCalledWith('*, profiles!comments_user_id_fkey(username, avatar_path)');
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

  describe('deleting a comment', () => {
    // The first comment of `existing` ("Nice post") is written by the logged-in user
    const mine = [{ ...existing[0], user_id: TEST_USER.id }, existing[1]];
    const deleteButtons = () => screen.queryAllByRole('button', { name: 'Delete comment' });

    it('offers a delete button on the own comments only', async () => {
      mockTable({ comments: mine });
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Nice post');

      expect(deleteButtons()).toHaveLength(1);
      // The button is on the row of "Nice post", not on somebody else's
      expect(screen.getByText('Nice post').parentElement).toContainElement(deleteButtons()[0]);
    });

    it('has no delete button when all the comments are somebody else\'s', async () => {
      mockTable();
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Nice post');

      expect(deleteButtons()).toHaveLength(0);
    });

    it('deletes exactly that comment, removes it from the list and tells the post card', async () => {
      mockTable({ comments: mine });
      const onChange = vi.fn();
      renderWithProviders(<CommentSection postId={7} onChange={onChange} />);
      await screen.findByText('Nice post');

      await userEvent.click(deleteButtons()[0]);

      await waitFor(() => expect(screen.queryByText('Nice post')).not.toBeInTheDocument());
      expect(deleteQuery.delete).toHaveBeenCalled();
      expect(deleteQuery.eq).toHaveBeenCalledWith('id', 2);
      expect(screen.getByText('First!')).toBeInTheDocument(); // the others stay
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('works without an onChange function', async () => {
      mockTable({ comments: mine });
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Nice post');

      await userEvent.click(deleteButtons()[0]);

      await waitFor(() => expect(screen.queryByText('Nice post')).not.toBeInTheDocument());
    });

    it('keeps the comment and shows a toast when deleting fails', async () => {
      mockTable({ comments: mine, deleteResult: { error: { message: 'not allowed' } } });
      const onChange = vi.fn();
      renderWithProviders(<CommentSection postId={7} onChange={onChange} />);
      await screen.findByText('Nice post');

      await userEvent.click(deleteButtons()[0]);

      expect(await screen.findByText('Could not delete comment: not allowed')).toBeInTheDocument();
      expect(screen.getByText('Nice post')).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('removes a comment that somebody else deletes while it is on the screen', async () => {
      mockTable();
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Nice post');
      const deleted = channel.on.mock.calls.find(([, o]) => o.event === 'DELETE');
      expect(deleted[1]).toMatchObject({ table: 'comments' });
      expect(deleted[1].filter).toBeUndefined(); // the event has only the id: it cannot be filtered

      await act(async () => deleted[2]({ old: { id: 2 } }));

      expect(screen.queryByText('Nice post')).not.toBeInTheDocument();
      expect(screen.getByText('First!')).toBeInTheDocument();
    });

    it('ignores the deletion of a comment that is not on the screen (any post of the service)', async () => {
      mockTable();
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Nice post');
      const deleted = channel.on.mock.calls.find(([, o]) => o.event === 'DELETE');

      await act(async () => deleted[2]({ old: { id: 999 } }));

      expect(screen.getByText('Nice post')).toBeInTheDocument();
      expect(screen.getByText('First!')).toBeInTheDocument();
    });
  });

  describe('pages', () => {
    let queries;

    // Every request for comments gets the next prepared answer
    function mockPages(...answers) {
      queries = answers.map((data) => createQuery(data));
      let call = 0;
      supabase.from.mockReturnValue({
        select: () => queries[Math.min(call++, queries.length - 1)],
        insert: () => createQuery({ error: null }),
      });
    }
    const ok = (data) => ({ data, error: null });
    // The paragraph also holds the name of the author, so take the "Comment 12" part
    const shown = () => screen.getAllByText(/Comment \d+$/).map((el) => el.textContent.match(/Comment \d+$/)[0]);

    it('offers more comments only when the first page was full', async () => {
      mockPages(ok(makeComments(19, 19)));
      const { unmount } = renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Comment 19');
      expect(screen.queryByRole('button', { name: 'Load more comments' })).not.toBeInTheDocument();
      unmount();

      mockPages(ok(makeComments(20, 20)));
      renderWithProviders(<CommentSection postId={7} />);
      expect(await screen.findByRole('button', { name: 'Load more comments' })).toBeInTheDocument();
    });

    it('loads the 20 comments below the oldest one on the screen', async () => {
      mockPages(ok(makeComments(20, 40)), ok(makeComments(5, 20)));
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Comment 40');

      await userEvent.click(screen.getByRole('button', { name: 'Load more comments' }));

      expect(await screen.findByText('Comment 16')).toBeInTheDocument();
      expect(queries[1].lt).toHaveBeenCalledWith('id', 21);
      expect(queries[1].limit).toHaveBeenCalledWith(20);
      expect(queries[1].eq).toHaveBeenCalledWith('post_id', 7);
      expect(shown()).toHaveLength(25);
      expect(shown()[24]).toBe('Comment 16'); // the older ones come below
      // The last page had fewer than 20: nothing more to ask for
      expect(screen.queryByRole('button', { name: 'Load more comments' })).not.toBeInTheDocument();
    });

    it('keeps the button when the next page is full as well', async () => {
      mockPages(ok(makeComments(20, 60)), ok(makeComments(20, 40)));
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Comment 60');

      await userEvent.click(screen.getByRole('button', { name: 'Load more comments' }));
      await screen.findByText('Comment 21');

      expect(screen.getByRole('button', { name: 'Load more comments' })).toBeInTheDocument();
    });

    it('shows no comment twice when two pages overlap', async () => {
      mockPages(ok(makeComments(20, 40)), ok(makeComments(3, 21)));
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Comment 40');

      await userEvent.click(screen.getByRole('button', { name: 'Load more comments' }));
      await screen.findByText('Comment 19');

      expect(screen.getAllByText('Comment 21')).toHaveLength(1);
      expect(shown()).toHaveLength(22);
    });

    it('shows a toast and keeps what is shown when the next page cannot be loaded', async () => {
      mockPages(ok(makeComments(20, 40)), { data: null, error: { message: 'network down' } });
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Comment 40');

      await userEvent.click(screen.getByRole('button', { name: 'Load more comments' }));

      expect(await screen.findByText('Could not load more comments: network down')).toBeInTheDocument();
      expect(shown()).toHaveLength(20);
      expect(screen.getByRole('button', { name: 'Load more comments' })).toBeEnabled();
    });

    it('disables the button and says so while the next page is on its way', async () => {
      let answer;
      mockPages(ok(makeComments(20, 40)), new Promise((resolve) => { answer = resolve; }));
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Comment 40');

      await userEvent.click(screen.getByRole('button', { name: 'Load more comments' }));
      expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled();

      await act(async () => answer(ok(makeComments(2, 20))));
      expect(await screen.findByText('Comment 19')).toBeInTheDocument();
    });

    it('puts a comment that arrives in real time on top, asking only for newer ones', async () => {
      mockPages(ok(makeComments(3, 10)), ok([{ ...makeComments(1, 11)[0] }]));
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Comment 10');

      const [, , onInsert] = channel.on.mock.calls[0];
      await act(async () => onInsert());

      expect(await screen.findByText('Comment 11')).toBeInTheDocument();
      expect(shown()).toEqual(['Comment 11', 'Comment 10', 'Comment 9', 'Comment 8']);
      expect(queries[1].gt).toHaveBeenCalledWith('id', 10);
      expect(queries[1].limit).not.toHaveBeenCalled();
    });

    it('does not show a new comment twice if it is reported twice', async () => {
      const arrived = ok([makeComments(1, 11)[0]]);
      mockPages(ok(makeComments(2, 10)), arrived, arrived);
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Comment 10');
      const [, , onInsert] = channel.on.mock.calls[0];

      await act(async () => onInsert());
      await screen.findByText('Comment 11');
      await act(async () => onInsert());

      expect(screen.getAllByText('Comment 11')).toHaveLength(1);
    });

    it('shows a comment that was just written on top at once', async () => {
      mockPages(ok(makeComments(2, 10)), ok([makeComments(1, 11)[0]]));
      renderWithProviders(<CommentSection postId={7} />);
      await screen.findByText('Comment 10');

      await userEvent.type(input(), 'mine');
      await userEvent.click(sendButton());

      expect(await screen.findByText('Comment 11')).toBeInTheDocument();
      expect(shown()[0]).toBe('Comment 11');
      expect(queries[1].gt).toHaveBeenCalledWith('id', 10);
    });

    it('starts from the beginning when the post has no comments yet', async () => {
      mockPages(ok([]), ok([makeComments(1, 1)[0]]));
      renderWithProviders(<CommentSection postId={7} />);
      await waitFor(() => expect(input()).toBeInTheDocument());

      const [, , onInsert] = channel.on.mock.calls[0];
      await act(async () => onInsert());

      expect(await screen.findByText('Comment 1')).toBeInTheDocument();
      expect(queries[1].gt).not.toHaveBeenCalled(); // nothing to be newer than
      expect(queries[1].limit).toHaveBeenCalledWith(20);
    });
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
