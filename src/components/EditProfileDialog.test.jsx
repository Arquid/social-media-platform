import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditProfileDialog from './EditProfileDialog';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery } from '../test/supabaseMock';

const storageApi = { upload: vi.fn(), remove: vi.fn(), getPublicUrl: vi.fn() };

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), storage: { from: vi.fn() } },
}));

const profile = {
  id: TEST_USER.id,
  username: 'me',
  display_name: 'Old Name',
  bio: 'Old bio',
  avatar_path: null,
};

const profileWithAvatar = { ...profile, avatar_path: `${TEST_USER.id}/old.png` };

const png = () => new File(['x'], 'photo.png', { type: 'image/png' });

function setup(props = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const user = userEvent.setup({ applyAccept: false }); // lets us test files the picker would hide
  renderWithProviders(
    <EditProfileDialog profile={profile} onClose={onClose} onSaved={onSaved} {...props} />
  );
  return { user, onClose, onSaved };
}

describe('EditProfileDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.storage.from.mockReturnValue(storageApi);
    storageApi.getPublicUrl.mockImplementation((path) => ({
      data: { publicUrl: `http://storage.test/avatars/${path}` },
    }));
    storageApi.upload.mockResolvedValue({ error: null });
    storageApi.remove.mockResolvedValue({ error: null });
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with the current display name and bio', () => {
    setup();

    expect(screen.getByLabelText('Display name')).toHaveValue('Old Name');
    expect(screen.getByLabelText('Bio')).toHaveValue('Old bio');
    expect(screen.getByText('7/160')).toBeInTheDocument();
  });

  it('counts the characters of the bio', async () => {
    const { user } = setup();

    await user.clear(screen.getByLabelText('Bio'));
    await user.type(screen.getByLabelText('Bio'), 'Hello');

    expect(screen.getByText('5/160')).toBeInTheDocument();
  });

  it('saves the text fields without touching storage when the picture is unchanged', async () => {
    const saved = { ...profile, display_name: 'New Name', bio: 'New bio' };
    const query = createQuery({ data: saved, error: null });
    supabase.from.mockReturnValue(query);
    const { user, onSaved } = setup();

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), '  New Name  ');
    await user.clear(screen.getByLabelText('Bio'));
    await user.type(screen.getByLabelText('Bio'), 'New bio');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(query.update).toHaveBeenCalledWith({
      display_name: 'New Name', // trimmed
      bio: 'New bio',
      avatar_path: null,
    });
    expect(query.eq).toHaveBeenCalledWith('id', TEST_USER.id);
    expect(storageApi.upload).not.toHaveBeenCalled();
    expect(storageApi.remove).not.toHaveBeenCalled();
  });

  it('saves an empty display name as null', async () => {
    supabase.from.mockReturnValue(createQuery({ data: profile, error: null }));
    const { user } = setup();

    await user.clear(screen.getByLabelText('Display name'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(supabase.from).toHaveBeenCalled());
    const query = supabase.from.mock.results[0].value;
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ display_name: null }));
  });

  it('uploads a new picture, saves its path and removes the old picture', async () => {
    const query = createQuery({ data: profileWithAvatar, error: null });
    supabase.from.mockReturnValue(query);
    const { user, onSaved } = setup({ profile: profileWithAvatar });

    await user.upload(document.querySelector('input[type="file"]'), png());
    expect(screen.getByAltText('Profile picture preview')).toHaveAttribute('src', 'blob:preview');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [uploadedPath] = storageApi.upload.mock.calls[0];
    expect(uploadedPath).toMatch(new RegExp(`^${TEST_USER.id}/\\d+\\.png$`));
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ avatar_path: uploadedPath }));
    expect(storageApi.remove).toHaveBeenCalledWith([profileWithAvatar.avatar_path]);
  });

  it('rejects a file that is not an image and keeps the old picture', async () => {
    const { user } = setup({ profile: profileWithAvatar });

    await user.upload(
      document.querySelector('input[type="file"]'),
      new File(['hi'], 'notes.txt', { type: 'text/plain' })
    );

    expect(screen.getByText(/JPEG, PNG or WebP/)).toBeInTheDocument();
    expect(screen.getByAltText('Profile picture preview')).toHaveAttribute(
      'src',
      `http://storage.test/avatars/${profileWithAvatar.avatar_path}`
    );
  });

  it('rejects a picture larger than 2 MB', async () => {
    const { user } = setup();
    const huge = new File([new ArrayBuffer(2 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' });

    await user.upload(document.querySelector('input[type="file"]'), huge);

    expect(screen.getByText(/smaller than 2 MB/)).toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('shows a toast and does not save the profile when the upload fails', async () => {
    storageApi.upload.mockResolvedValue({ error: { message: 'storage down' } });
    const { user, onSaved } = setup();

    await user.upload(document.querySelector('input[type="file"]'), png());
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Could not upload the image: storage down')).toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('removes the new upload again when saving the profile fails', async () => {
    supabase.from.mockReturnValue(createQuery({ data: null, error: { message: 'bio too long' } }));
    const { user, onSaved } = setup({ profile: profileWithAvatar });

    await user.upload(document.querySelector('input[type="file"]'), png());
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Could not save the profile: bio too long')).toBeInTheDocument();
    const [uploadedPath] = storageApi.upload.mock.calls[0];
    // The new file is cleaned up, the old one is kept
    expect(storageApi.remove).toHaveBeenCalledTimes(1);
    expect(storageApi.remove).toHaveBeenCalledWith([uploadedPath]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('removes the picture: saves a null path and deletes the old file', async () => {
    const query = createQuery({ data: profile, error: null });
    supabase.from.mockReturnValue(query);
    const { user, onSaved } = setup({ profile: profileWithAvatar });

    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(screen.queryByAltText('Profile picture preview')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ avatar_path: null }));
    expect(storageApi.remove).toHaveBeenCalledWith([profileWithAvatar.avatar_path]);
  });

  it('disables "Remove photo" when there is no picture to remove', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeDisabled();
  });

  it('closes without saving when Cancel is pressed', async () => {
    const { user, onClose, onSaved } = setup();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('frees the preview URL when a new picture replaces it', async () => {
    const { user } = setup();
    const input = () => document.querySelector('input[type="file"]');

    await user.upload(input(), png());
    URL.createObjectURL.mockReturnValue('blob:second');
    await user.upload(input(), png());

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });
});
