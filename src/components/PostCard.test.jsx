import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostCard from './PostCard';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery } from '../test/supabaseMock';

const { removeFromStorage } = vi.hoisted(() => ({ removeFromStorage: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
    storage: {
      from: () => ({
        getPublicUrl: (p) => ({ data: { publicUrl: `http://storage.test/${p}` } }),
        remove: removeFromStorage,
      }),
    },
  },
}));

// The comment section has its own tests; here it is only a placeholder that remembers what it was given
const { commentSectionProps } = vi.hoisted(() => ({ commentSectionProps: [] }));
vi.mock('./CommentSection', () => ({
  default: (props) => {
    commentSectionProps.push(props);
    return <div>Comments of post {props.postId}</div>;
  },
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

  it('shows how long ago the post was written, with the exact time as a tooltip', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // only the date, so the timers of the page keep working
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
    try {
      const created = new Date(2026, 5, 15, 9, 0);
      renderWithProviders(<PostCard post={{ ...basePost, created_at: created.toISOString() }} />);

      const time = screen.getByText('3 hours ago');
      expect(time.tagName).toBe('TIME');
      expect(time).toHaveAttribute('dateTime', created.toISOString());
      expect(time.getAttribute('title').replace(/\s/g, ' ')).toBe('Jun 15, 2026, 9:00 AM');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the date for an old post', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
    try {
      renderWithProviders(<PostCard post={{ ...basePost, created_at: new Date(2025, 2, 3, 10, 0).toISOString() }} />);

      expect(screen.getByText('Mar 3, 2025')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the author\'s first letter when they have no avatar', () => {
    renderWithProviders(<PostCard post={basePost} />);

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: "author's avatar" })).not.toBeInTheDocument();
  });

  it('shows the author\'s avatar picture when they have one', () => {
    renderWithProviders(<PostCard post={{ ...basePost, avatar_path: 'author-1/me.png' }} />);

    expect(screen.getByRole('img', { name: "author's avatar" })).toHaveAttribute(
      'src',
      'http://storage.test/author-1/me.png'
    );
  });

  it('keeps the comments closed by default and opens them on request', async () => {
    renderWithProviders(<PostCard post={basePost} />);

    expect(screen.queryByText('Comments of post 7')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show comments' }));
    expect(await screen.findByText('Comments of post 7')).toBeInTheDocument();
  });

  it('can start with the comments open (used on the post page)', async () => {
    renderWithProviders(<PostCard post={basePost} defaultShowComments />);

    expect(screen.getByText('Comments of post 7')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide comments' })).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Hide comments' }));
    await waitFor(() => expect(screen.queryByText('Comments of post 7')).not.toBeInTheDocument());
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

  describe('a picture in the post', () => {
    const withPicture = { ...basePost, image_path: 'author-1/1712345678.jpg' };

    it('shows the picture, with a description that names the author', () => {
      renderWithProviders(<PostCard post={withPicture} />);

      const picture = screen.getByRole('img', { name: 'Picture in the post of @author' });
      expect(picture).toHaveAttribute('src', 'http://storage.test/author-1/1712345678.jpg');
      expect(picture).toHaveAttribute('loading', 'lazy');
    });

    it('shows no picture for a post without one', () => {
      renderWithProviders(<PostCard post={{ ...basePost, image_path: null }} />);

      expect(screen.queryByRole('img', { name: /Picture in the post/ })).not.toBeInTheDocument();
    });

    it('keeps the picture visible while the text is being edited', async () => {
      renderWithProviders(<PostCard post={{ ...withPicture, user_id: TEST_USER.id }} />);

      await userEvent.click(screen.getByRole('button', { name: 'Edit post' }));

      expect(screen.getByRole('img', { name: 'Picture in the post of @author' })).toBeInTheDocument();
    });

    it('removes the file from the storage after the post has been deleted', async () => {
      supabase.from.mockReturnValue(createQuery({ error: null }));
      const onDelete = vi.fn();
      renderWithProviders(<PostCard post={{ ...withPicture, user_id: TEST_USER.id }} onDelete={onDelete} />);

      await userEvent.click(screen.getByRole('button', { name: 'Delete post' }));

      await waitFor(() => expect(onDelete).toHaveBeenCalledWith(7));
      expect(removeFromStorage).toHaveBeenCalledWith(['author-1/1712345678.jpg']);
    });

    it('does not touch the storage for a post without a picture', async () => {
      supabase.from.mockReturnValue(createQuery({ error: null }));
      const onDelete = vi.fn();
      renderWithProviders(<PostCard post={{ ...basePost, user_id: TEST_USER.id }} onDelete={onDelete} />);

      await userEvent.click(screen.getByRole('button', { name: 'Delete post' }));

      await waitFor(() => expect(onDelete).toHaveBeenCalled());
      expect(removeFromStorage).not.toHaveBeenCalled();
    });

    it('keeps the file when the post could not be deleted (the post is still there and needs it)', async () => {
      supabase.from.mockReturnValue(createQuery({ error: { message: 'denied' } }));
      renderWithProviders(<PostCard post={{ ...withPicture, user_id: TEST_USER.id }} />);

      await userEvent.click(screen.getByRole('button', { name: 'Delete post' }));

      await screen.findByText('Could not delete post: denied');
      expect(removeFromStorage).not.toHaveBeenCalled();
    });
  });

  describe('editing', () => {
    const mine = { ...basePost, user_id: TEST_USER.id };
    const editButton = () => screen.queryByRole('button', { name: 'Edit post' });
    const box = () => screen.getByRole('textbox', { name: 'Edit post text' });
    const saveButton = () => screen.getByRole('button', { name: 'Save' });

    it('offers an edit button on your own posts only', () => {
      const { unmount } = renderWithProviders(<PostCard post={basePost} />);
      expect(editButton()).not.toBeInTheDocument();
      unmount();

      renderWithProviders(<PostCard post={mine} />);
      expect(editButton()).toBeInTheDocument();
    });

    it('marks a post that has been edited, with the time of the edit as a tooltip', () => {
      const editedAt = '2026-10-01T10:30:00Z';
      renderWithProviders(<PostCard post={{ ...basePost, edited_at: editedAt }} />);

      const mark = screen.getByText(/· edited/);
      expect(mark).toHaveAttribute('title', `Edited ${new Date(editedAt).toLocaleString()}`);
    });

    it('does not say "edited" about a post that was never edited', () => {
      renderWithProviders(<PostCard post={{ ...basePost, edited_at: null }} />);

      expect(screen.queryByText(/edited/)).not.toBeInTheDocument();
    });

    it('opens a box with the current text, and hides the edit button while editing', async () => {
      renderWithProviders(<PostCard post={mine} />);

      await userEvent.click(editButton());

      expect(box()).toHaveValue('Hello world');
      expect(box()).toHaveFocus();
      expect(box()).toHaveAttribute('maxlength', '500');
      expect(editButton()).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete post' })).toBeInTheDocument();
    });

    it('saves the trimmed text, closes the box and asks the page to load the post again', async () => {
      const query = createQuery({ error: null });
      supabase.from.mockReturnValue(query);
      const onChange = vi.fn();
      renderWithProviders(<PostCard post={mine} onChange={onChange} />);
      await userEvent.click(editButton());

      await userEvent.clear(box());
      await userEvent.type(box(), '  a better text  ');
      await userEvent.click(saveButton());

      await waitFor(() => expect(onChange).toHaveBeenCalledWith(7));
      expect(supabase.from).toHaveBeenCalledWith('posts');
      expect(query.update).toHaveBeenCalledWith({ content: 'a better text' });
      expect(query.eq).toHaveBeenCalledWith('id', 7);
      expect(screen.queryByRole('textbox', { name: 'Edit post text' })).not.toBeInTheDocument();
      expect(editButton()).toBeInTheDocument();
    });

    it('does not touch the database when the text is the same', async () => {
      const onChange = vi.fn();
      renderWithProviders(<PostCard post={mine} onChange={onChange} />);
      await userEvent.click(editButton());

      await userEvent.type(box(), ' '); // only a space more: the same text after trimming
      await userEvent.click(saveButton());

      expect(supabase.from).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox', { name: 'Edit post text' })).not.toBeInTheDocument();
    });

    it('cannot save an empty text', async () => {
      renderWithProviders(<PostCard post={mine} />);
      await userEvent.click(editButton());

      await userEvent.clear(box());
      expect(saveButton()).toBeDisabled();
      await userEvent.type(box(), '   ');
      expect(saveButton()).toBeDisabled();

      await userEvent.keyboard('{Enter}');
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('Cancel throws the changes away and shows the old text', async () => {
      renderWithProviders(<PostCard post={mine} />);
      await userEvent.click(editButton());
      await userEvent.clear(box());
      await userEvent.type(box(), 'something else');

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.getByText('Hello world')).toBeInTheDocument();
      expect(screen.queryByText('something else')).not.toBeInTheDocument();
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('starts from the current text again when it is opened a second time', async () => {
      renderWithProviders(<PostCard post={mine} />);
      await userEvent.click(editButton());
      await userEvent.type(box(), ' more');
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await userEvent.click(editButton());

      expect(box()).toHaveValue('Hello world');
    });

    it('keeps the box open with the text and shows a toast when saving fails', async () => {
      supabase.from.mockReturnValue(createQuery({ error: { message: 'not allowed' } }));
      const onChange = vi.fn();
      renderWithProviders(<PostCard post={mine} onChange={onChange} />);
      await userEvent.click(editButton());
      await userEvent.clear(box());
      await userEvent.type(box(), 'my new text');

      await userEvent.click(saveButton());

      expect(await screen.findByText('Could not save the post: not allowed')).toBeInTheDocument();
      expect(box()).toHaveValue('my new text');
      expect(saveButton()).toBeEnabled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('is locked while saving, so a double click sends one request', async () => {
      let finish;
      const query = createQuery(new Promise((resolve) => { finish = resolve; }));
      supabase.from.mockReturnValue(query);
      renderWithProviders(<PostCard post={mine} onChange={vi.fn()} />);
      await userEvent.click(editButton());
      await userEvent.type(box(), '!');

      await userEvent.click(saveButton());
      expect(saveButton()).toBeDisabled();
      expect(box()).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

      await act(async () => finish({ error: null }));
      expect(supabase.from).toHaveBeenCalledTimes(1);
    });

    it('works without an onChange function', async () => {
      supabase.from.mockReturnValue(createQuery({ error: null }));
      renderWithProviders(<PostCard post={mine} />);
      await userEvent.click(editButton());
      await userEvent.type(box(), '!');

      await userEvent.click(saveButton());

      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit post text' })).not.toBeInTheDocument());
    });

    it('lets the comment section tell the page when a comment is deleted (the count changes)', async () => {
      const onChange = vi.fn();
      renderWithProviders(<PostCard post={mine} onChange={onChange} defaultShowComments />);

      commentSectionProps.at(-1).onChange();

      expect(onChange).toHaveBeenCalledWith(7);
    });
  });

  it('only shows the delete button on your own posts', () => {
    const { unmount } = renderWithProviders(<PostCard post={basePost} />);
    expect(screen.queryByRole('button', { name: 'Delete post' })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<PostCard post={{ ...basePost, user_id: TEST_USER.id }} />);
    expect(screen.getByRole('button', { name: 'Delete post' })).toBeInTheDocument();
  });

  it('keeps the post and shows a toast when deleting fails', async () => {
    supabase.from.mockReturnValue(createQuery({ error: { message: 'denied' } }));
    const onDelete = vi.fn();
    renderWithProviders(<PostCard post={{ ...basePost, user_id: TEST_USER.id }} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete post' }));

    expect(await screen.findByText('Could not delete post: denied')).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
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
