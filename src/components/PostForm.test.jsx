import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostForm from './PostForm';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

const RATE_LIMIT_ERROR = {
  code: 'PT429',
  message: 'You are posting too fast. Please wait a minute and try again.',
};

const box = () => screen.getByPlaceholderText("What's on your mind?");
const postButton = () => screen.getByRole('button', { name: 'Post' });

// MUI puts the severity in the class name of the alert
const severityOf = (alert) => alert.className.match(/MuiAlert-\w*(Error|Warning)/)?.[1];

async function write(text) {
  await userEvent.type(box(), text);
}

describe('PostForm', () => {
  let consoleError;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cannot be submitted while the box is empty or only has spaces', async () => {
    renderWithProviders(<PostForm />);
    expect(postButton()).toBeDisabled();

    await write('   ');
    expect(postButton()).toBeDisabled();

    await write('hello');
    expect(postButton()).toBeEnabled();
  });

  it('limits a post to 500 characters', () => {
    renderWithProviders(<PostForm />);
    expect(box()).toHaveAttribute('maxlength', '500');
  });

  it('saves the trimmed text as the logged-in user, clears the box and tells the parent', async () => {
    const query = createQuery({ error: null });
    supabase.from.mockReturnValue(query);
    const onPosted = vi.fn();
    renderWithProviders(<PostForm onPosted={onPosted} />);

    await write('  my first post  ');
    await userEvent.click(postButton());

    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1));
    expect(supabase.from).toHaveBeenCalledWith('posts');
    expect(query.insert).toHaveBeenCalledWith({ user_id: TEST_USER.id, content: 'my first post' });
    expect(box()).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the button while saving, so a double click sends one post', async () => {
    let finish;
    const saving = new Promise((resolve) => {
      finish = resolve;
    });
    const query = createQuery(saving);
    supabase.from.mockReturnValue(query);
    renderWithProviders(<PostForm />);

    await write('slow post');
    await userEvent.click(postButton());
    expect(postButton()).toBeDisabled();
    fireEvent.click(postButton()); // a real user cannot click it, but a script could

    await act(async () => finish({ error: null }));
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('does nothing when submitted without text', async () => {
    renderWithProviders(<PostForm />);
    await userEvent.type(box(), '   {Enter}');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('shows other errors in red, keeps the text and logs the error', async () => {
    supabase.from.mockReturnValue(createQuery({ error: { code: '23514', message: 'database says no' } }));
    const onPosted = vi.fn();
    renderWithProviders(<PostForm onPosted={onPosted} />);

    await write('keep me');
    await userEvent.click(postButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('database says no');
    expect(severityOf(alert)).toBe('Error');
    expect(box()).toHaveValue('keep me');
    expect(onPosted).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('Post insert failed:', expect.objectContaining({ code: '23514' }));
  });

  describe('when the rate limit is reached', () => {
    it('shows the database message as a yellow warning, not a red error', async () => {
      supabase.from.mockReturnValue(createQuery({ error: RATE_LIMIT_ERROR }));
      renderWithProviders(<PostForm />);

      await write('too many');
      await userEvent.click(postButton());

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(RATE_LIMIT_ERROR.message);
      expect(severityOf(alert)).toBe('Warning');
    });

    it('keeps the text so the user can send it again later', async () => {
      supabase.from.mockReturnValue(createQuery({ error: RATE_LIMIT_ERROR }));
      const onPosted = vi.fn();
      renderWithProviders(<PostForm onPosted={onPosted} />);

      await write('do not lose me');
      await userEvent.click(postButton());
      await screen.findByRole('alert');

      expect(box()).toHaveValue('do not lose me');
      expect(postButton()).toBeEnabled();
      expect(onPosted).not.toHaveBeenCalled();
    });

    it('does not log it as an error, because it is expected', async () => {
      supabase.from.mockReturnValue(createQuery({ error: RATE_LIMIT_ERROR }));
      renderWithProviders(<PostForm />);

      await write('x');
      await userEvent.click(postButton());
      await screen.findByRole('alert');

      expect(consoleError).not.toHaveBeenCalled();
    });

    it('goes away when the next attempt works', async () => {
      supabase.from
        .mockReturnValueOnce(createQuery({ error: RATE_LIMIT_ERROR }))
        .mockReturnValueOnce(createQuery({ error: null }));
      renderWithProviders(<PostForm />);

      await write('second try');
      await userEvent.click(postButton());
      await screen.findByRole('alert');

      await userEvent.click(postButton());

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
      expect(box()).toHaveValue('');
    });

    it('turns red again if the next attempt fails for another reason', async () => {
      supabase.from
        .mockReturnValueOnce(createQuery({ error: RATE_LIMIT_ERROR }))
        .mockReturnValueOnce(createQuery({ error: { code: '23514', message: 'something else' } }));
      renderWithProviders(<PostForm />);

      await write('text');
      await userEvent.click(postButton());
      expect(severityOf(await screen.findByRole('alert'))).toBe('Warning');

      await userEvent.click(postButton());

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('something else'));
      expect(severityOf(screen.getByRole('alert'))).toBe('Error');
    });
  });
});
