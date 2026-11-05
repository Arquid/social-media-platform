import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MAX_AVATAR_BYTES, validateAvatarFile, getAvatarUrl, uploadAvatar, deleteAvatar, deleteAllAvatars,
} from './avatars';
import { supabase } from './supabaseClient';

const storageApi = { upload: vi.fn(), remove: vi.fn(), getPublicUrl: vi.fn(), list: vi.fn() };

vi.mock('./supabaseClient', () => ({
  supabase: { storage: { from: vi.fn() } },
}));

function fakeFile(type, size = 100) {
  return { type, size, name: 'file' };
}

describe('validateAvatarFile', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
    expect(validateAvatarFile(fakeFile(type))).toBe('');
  });

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', 'text/plain', ''])(
    'rejects the type "%s"',
    (type) => {
      expect(validateAvatarFile(fakeFile(type))).toMatch(/JPEG, PNG or WebP/);
    }
  );

  it('accepts a file of exactly 2 MB and rejects one byte more', () => {
    expect(validateAvatarFile(fakeFile('image/png', MAX_AVATAR_BYTES))).toBe('');
    expect(validateAvatarFile(fakeFile('image/png', MAX_AVATAR_BYTES + 1))).toMatch(/smaller than 2 MB/);
  });
});

describe('avatar storage helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.storage.from.mockReturnValue(storageApi);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('getAvatarUrl returns undefined without a path and does not touch storage', () => {
    expect(getAvatarUrl(null)).toBeUndefined();
    expect(getAvatarUrl('')).toBeUndefined();
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  it('getAvatarUrl returns the public URL from the avatars bucket', () => {
    storageApi.getPublicUrl.mockReturnValue({ data: { publicUrl: 'http://x/avatars/u1/a.png' } });

    expect(getAvatarUrl('u1/a.png')).toBe('http://x/avatars/u1/a.png');
    expect(supabase.storage.from).toHaveBeenCalledWith('avatars');
    expect(storageApi.getPublicUrl).toHaveBeenCalledWith('u1/a.png');
  });

  it('uploadAvatar stores the file in the user\'s own folder with a new name each time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T08:00:00Z'));
    storageApi.upload.mockResolvedValue({ error: null });
    const file = fakeFile('image/webp');

    const result = await uploadAvatar('user-1', file);

    expect(result).toEqual({ path: `user-1/${Date.now()}.webp` });
    expect(storageApi.upload).toHaveBeenCalledWith(result.path, file, { contentType: 'image/webp' });
  });

  it('uploadAvatar returns the error when the upload fails', async () => {
    storageApi.upload.mockResolvedValue({ error: { message: 'nope' } });

    const result = await uploadAvatar('user-1', fakeFile('image/png'));

    expect(result).toEqual({ error: { message: 'nope' } });
  });

  it('deleteAvatar removes the file, and does nothing without a path', async () => {
    storageApi.remove.mockResolvedValue({ error: null });

    await deleteAvatar(null);
    expect(storageApi.remove).not.toHaveBeenCalled();

    await deleteAvatar('user-1/old.png');
    expect(storageApi.remove).toHaveBeenCalledWith(['user-1/old.png']);
  });
});

describe('deleteAllAvatars (used when an account is deleted)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.storage.from.mockReturnValue(storageApi);
  });

  it('removes every file in the folder of the user', async () => {
    storageApi.list.mockResolvedValue({ data: [{ name: '1.png' }, { name: '2.jpg' }], error: null });
    storageApi.remove.mockResolvedValue({ error: null });

    const result = await deleteAllAvatars('user-1');

    expect(supabase.storage.from).toHaveBeenCalledWith('avatars');
    expect(storageApi.list).toHaveBeenCalledWith('user-1');
    expect(storageApi.remove).toHaveBeenCalledWith(['user-1/1.png', 'user-1/2.jpg']);
    expect(result).toEqual({});
  });

  it('does not call remove when there is no picture', async () => {
    storageApi.list.mockResolvedValue({ data: [], error: null });

    expect(await deleteAllAvatars('user-1')).toEqual({});
    expect(storageApi.remove).not.toHaveBeenCalled();
  });

  it('returns the error and removes nothing when the folder cannot be listed', async () => {
    storageApi.list.mockResolvedValue({ data: null, error: { message: 'storage down' } });

    expect(await deleteAllAvatars('user-1')).toEqual({ error: { message: 'storage down' } });
    expect(storageApi.remove).not.toHaveBeenCalled();
  });

  it('returns the error when the files cannot be removed', async () => {
    storageApi.list.mockResolvedValue({ data: [{ name: '1.png' }], error: null });
    storageApi.remove.mockResolvedValue({ error: { message: 'no permission' } });

    expect(await deleteAllAvatars('user-1')).toEqual({ error: { message: 'no permission' } });
  });
});
