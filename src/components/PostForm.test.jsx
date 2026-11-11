import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostForm from './PostForm';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery } from '../test/supabaseMock';
import { uploadPostImage, deletePostImage } from '../lib/postImages';
import { logError } from '../lib/errorReporting';

// The real logging is kept (console and all); the test only watches what it is asked to log
vi.mock('../lib/errorReporting', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, logError: vi.fn(actual.logError) };
});

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));
// The real checks of the file are used; the storage is not
vi.mock('../lib/postImages', async (importOriginal) => ({
  ...(await importOriginal()),
  uploadPostImage: vi.fn(),
  deletePostImage: vi.fn(),
}));

const RATE_LIMIT_ERROR = {
  code: 'PT429',
  message: 'You are posting too fast. Please wait a minute and try again.',
};

// What the database sends back for a saved post: the id of the new row
const SAVED = { data: { id: 42 }, error: null };

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
    const query = createQuery(SAVED);
    supabase.from.mockReturnValue(query);
    const onPosted = vi.fn();
    renderWithProviders(<PostForm onPosted={onPosted} />);

    await write('  my first post  ');
    await userEvent.click(postButton());

    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1));
    // The parent gets the id of the new post, so it can show the post at once
    expect(onPosted).toHaveBeenCalledWith(42);
    expect(query.select).toHaveBeenCalledWith('id');
    expect(query.single).toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalledWith('posts');
    expect(query.insert).toHaveBeenCalledWith({ user_id: TEST_USER.id, content: 'my first post', image_path: null });
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

    await act(async () => finish(SAVED));
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
    expect(logError).toHaveBeenCalledWith('Post insert failed:', expect.objectContaining({ code: '23514' }));
  });

  describe('a picture in the post', () => {
    const png = (size) => {
      const file = new File(['x'], 'photo.png', { type: 'image/png' });
      if (size) Object.defineProperty(file, 'size', { value: size });
      return file;
    };
    const fileInput = () => document.querySelector('input[type="file"]');
    const preview = () => screen.queryByRole('img', { name: 'Picture to be posted' });
    // applyAccept off: a test can then also choose the files that the file picker would hide
    const choose = (file) => userEvent.setup({ applyAccept: false }).upload(fileInput(), file);

    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:preview');
      URL.revokeObjectURL = vi.fn();
      uploadPostImage.mockResolvedValue({ path: `${TEST_USER.id}/1712345678.png` });
      deletePostImage.mockResolvedValue();
    });

    it('offers a button for adding a picture that accepts JPEG, PNG and WebP', () => {
      renderWithProviders(<PostForm />);

      expect(screen.getByText('Add picture')).toBeInTheDocument();
      expect(fileInput()).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    });

    it('shows a preview of the chosen picture, and a button for removing it', async () => {
      renderWithProviders(<PostForm />);

      await choose(png());

      expect(preview()).toHaveAttribute('src', 'blob:preview');
      expect(screen.getByRole('button', { name: 'Remove picture' })).toBeInTheDocument();
    });

    it('refuses a file of the wrong type, with a message, and shows no preview', async () => {
      renderWithProviders(<PostForm />);

      await choose(new File(['x'], 'funny.gif', { type: 'image/gif' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Please choose a JPEG, PNG or WebP picture.');
      expect(preview()).not.toBeInTheDocument();
    });

    it('refuses a picture of more than 5 MB', async () => {
      renderWithProviders(<PostForm />);

      await choose(png(5 * 1024 * 1024 + 1));

      expect(await screen.findByRole('alert')).toHaveTextContent('The picture must be smaller than 5 MB.');
      expect(preview()).not.toBeInTheDocument();
    });

    it('keeps the picture that was chosen before when a bad file is chosen afterwards', async () => {
      renderWithProviders(<PostForm />);
      await choose(png());

      await choose(new File(['x'], 'funny.gif', { type: 'image/gif' }));

      await screen.findByRole('alert');
      expect(preview()).toBeInTheDocument();
    });

    it('removes the picture with its button and frees the preview', async () => {
      renderWithProviders(<PostForm />);
      await choose(png());

      await userEvent.click(screen.getByRole('button', { name: 'Remove picture' }));

      expect(preview()).not.toBeInTheDocument();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    });

    it('uploads the picture first, then saves the post with the place of the picture', async () => {
      const order = [];
      uploadPostImage.mockImplementation(async () => {
        order.push('upload');
        return { path: `${TEST_USER.id}/1712345678.png` };
      });
      const query = createQuery(SAVED);
      query.insert.mockImplementation(() => {
        order.push('insert');
        return query;
      });
      supabase.from.mockReturnValue(query);
      const onPosted = vi.fn();
      const file = png();
      renderWithProviders(<PostForm onPosted={onPosted} />);
      await choose(file);

      await write('with a picture');
      await userEvent.click(postButton());

      await waitFor(() => expect(onPosted).toHaveBeenCalledWith(42));
      expect(order).toEqual(['upload', 'insert']);
      expect(uploadPostImage).toHaveBeenCalledWith(TEST_USER.id, file);
      expect(query.insert).toHaveBeenCalledWith({
        user_id: TEST_USER.id, content: 'with a picture', image_path: `${TEST_USER.id}/1712345678.png`,
      });
      // The form is empty again, also the picture
      expect(box()).toHaveValue('');
      expect(preview()).not.toBeInTheDocument();
      expect(deletePostImage).not.toHaveBeenCalled();
    });

    it('does not upload anything for a post without a picture', async () => {
      supabase.from.mockReturnValue(createQuery(SAVED));
      renderWithProviders(<PostForm />);

      await write('only text');
      await userEvent.click(postButton());

      await waitFor(() => expect(box()).toHaveValue(''));
      expect(uploadPostImage).not.toHaveBeenCalled();
    });

    it('does not save the post when the picture cannot be uploaded, and keeps the text and the picture', async () => {
      uploadPostImage.mockResolvedValue({ error: { message: 'storage down' } });
      renderWithProviders(<PostForm />);
      await choose(png());
      await write('keep me');

      await userEvent.click(postButton());

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not upload the picture: storage down');
      expect(supabase.from).not.toHaveBeenCalled();
      expect(box()).toHaveValue('keep me');
      expect(preview()).toBeInTheDocument();
      expect(postButton()).toBeEnabled();
    });

    it('removes the uploaded file again when the post cannot be saved, so no file is left behind', async () => {
      supabase.from.mockReturnValue(createQuery({ data: null, error: { code: '23514', message: 'database says no' } }));
      renderWithProviders(<PostForm />);
      await choose(png());
      await write('will fail');

      await userEvent.click(postButton());

      expect(await screen.findByRole('alert')).toHaveTextContent('database says no');
      expect(deletePostImage).toHaveBeenCalledWith(`${TEST_USER.id}/1712345678.png`);
      // Everything stays in the form, so the user can try again
      expect(box()).toHaveValue('will fail');
      expect(preview()).toBeInTheDocument();
    });

    it('also removes the file when the rate limit stops the post, and shows the yellow warning', async () => {
      supabase.from.mockReturnValue(createQuery({ data: null, error: RATE_LIMIT_ERROR }));
      renderWithProviders(<PostForm />);
      await choose(png());
      await write('too fast');

      await userEvent.click(postButton());

      const alert = await screen.findByRole('alert');
      expect(severityOf(alert)).toBe('Warning');
      expect(deletePostImage).toHaveBeenCalledWith(`${TEST_USER.id}/1712345678.png`);
    });

    it('locks the buttons while the post is being saved', async () => {
      let finish;
      uploadPostImage.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      supabase.from.mockReturnValue(createQuery(SAVED));
      renderWithProviders(<PostForm />);
      await choose(png());
      await write('slow');

      await userEvent.click(postButton());

      expect(postButton()).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Remove picture' })).toBeDisabled();
      expect(screen.getByText('Add picture').closest('label')).toHaveAttribute('aria-disabled', 'true');

      await act(async () => finish({ path: `${TEST_USER.id}/1.png` }));
      await waitFor(() => expect(box()).toHaveValue(''));
    });

    it('"Add picture" is a label around the file input, not a button with another control inside', () => {
      renderWithProviders(<PostForm />);

      const label = screen.getByText('Add picture').closest('label');
      expect(label).not.toHaveAttribute('role');
      expect(screen.queryByRole('button', { name: 'Add picture' })).not.toBeInTheDocument();
    });
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
      expect(logError).not.toHaveBeenCalled(); // an expected limit, not a bug to be told about
    });

    it('goes away when the next attempt works', async () => {
      supabase.from
        .mockReturnValueOnce(createQuery({ error: RATE_LIMIT_ERROR }))
        .mockReturnValueOnce(createQuery(SAVED));
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
