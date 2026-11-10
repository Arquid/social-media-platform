import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MAX_POST_IMAGE_BYTES, POST_IMAGE_TYPES, validatePostImage, getPostImageUrl, uploadPostImage,
  deletePostImage, deleteAllPostImages,
} from './postImages';
import { supabase } from './supabaseClient';

const storageApi = { upload: vi.fn(), remove: vi.fn(), getPublicUrl: vi.fn(), list: vi.fn() };

vi.mock('./supabaseClient', () => ({
  supabase: { storage: { from: vi.fn() } },
}));

const fakeFile = (type, size = 100) => ({ type, size, name: 'file' });

describe('validatePostImage', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
    expect(validatePostImage(fakeFile(type))).toBe('');
  });

  it('lists exactly the three types the storage accepts', () => {
    expect(POST_IMAGE_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', 'text/plain', ''])('rejects the type "%s"', (type) => {
    expect(validatePostImage(fakeFile(type))).toMatch(/JPEG, PNG or WebP/);
  });

  it('accepts a picture of exactly 5 MB and rejects one byte more', () => {
    expect(MAX_POST_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(validatePostImage(fakeFile('image/png', MAX_POST_IMAGE_BYTES))).toBe('');
    expect(validatePostImage(fakeFile('image/png', MAX_POST_IMAGE_BYTES + 1))).toMatch(/smaller than 5 MB/);
  });

  it('checks the type before the size', () => {
    expect(validatePostImage(fakeFile('image/gif', MAX_POST_IMAGE_BYTES + 1))).toMatch(/JPEG, PNG or WebP/);
  });
});

describe('post picture storage helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.storage.from.mockReturnValue(storageApi);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('getPostImageUrl gives the public address from the post-images bucket, and nothing without a path', () => {
    storageApi.getPublicUrl.mockReturnValue({ data: { publicUrl: 'http://storage.test/u1/a.png' } });

    expect(getPostImageUrl(null)).toBeUndefined();
    expect(getPostImageUrl('')).toBeUndefined();
    expect(getPostImageUrl('u1/a.png')).toBe('http://storage.test/u1/a.png');
    expect(supabase.storage.from).toHaveBeenCalledWith('post-images');
    expect(storageApi.getPublicUrl).toHaveBeenCalledWith('u1/a.png');
  });

  it('uploadPostImage puts the file into the folder of the user, named by the time and the type', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T08:00:00Z'));
    storageApi.upload.mockResolvedValue({ error: null });
    const file = fakeFile('image/webp');

    const result = await uploadPostImage('user-1', file);

    const path = `user-1/${new Date('2026-09-30T08:00:00Z').getTime()}.webp`;
    expect(result).toEqual({ path });
    expect(supabase.storage.from).toHaveBeenCalledWith('post-images');
    expect(storageApi.upload).toHaveBeenCalledWith(path, file, { contentType: 'image/webp' });
  });

  it.each([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']])('names a %s file ".%s"', async (type, extension) => {
    storageApi.upload.mockResolvedValue({ error: null });

    const { path } = await uploadPostImage('user-1', fakeFile(type));

    expect(path).toMatch(new RegExp(`^user-1/\\d+\\.${extension}$`));
  });

  it('uploadPostImage returns the error and no path when the storage refuses', async () => {
    storageApi.upload.mockResolvedValue({ error: { message: 'too big' } });

    expect(await uploadPostImage('user-1', fakeFile('image/png'))).toEqual({ error: { message: 'too big' } });
  });

  it('deletePostImage removes the file, and does nothing without a path', async () => {
    storageApi.remove.mockResolvedValue({ error: null });

    await deletePostImage(null);
    await deletePostImage(undefined);
    expect(storageApi.remove).not.toHaveBeenCalled();

    await deletePostImage('u1/a.png');
    expect(supabase.storage.from).toHaveBeenCalledWith('post-images');
    expect(storageApi.remove).toHaveBeenCalledWith(['u1/a.png']);
  });
});

describe('deleteAllPostImages (used when an account is deleted)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.storage.from.mockReturnValue(storageApi);
  });

  it('removes every file in the folder of the user', async () => {
    storageApi.list.mockResolvedValue({ data: [{ name: '1.png' }, { name: '2.jpg' }], error: null });
    storageApi.remove.mockResolvedValue({ error: null });

    const result = await deleteAllPostImages('user-1');

    expect(supabase.storage.from).toHaveBeenCalledWith('post-images');
    expect(storageApi.list).toHaveBeenCalledWith('user-1');
    expect(storageApi.remove).toHaveBeenCalledWith(['user-1/1.png', 'user-1/2.jpg']);
    expect(result).toEqual({});
  });

  it('does not call remove when there is nothing to remove', async () => {
    storageApi.list.mockResolvedValue({ data: [], error: null });

    expect(await deleteAllPostImages('user-1')).toEqual({});
    expect(storageApi.remove).not.toHaveBeenCalled();
  });

  it('returns the error and removes nothing when the folder cannot be listed', async () => {
    storageApi.list.mockResolvedValue({ data: null, error: { message: 'storage down' } });

    expect(await deleteAllPostImages('user-1')).toEqual({ error: { message: 'storage down' } });
    expect(storageApi.remove).not.toHaveBeenCalled();
  });

  it('returns the error when the files cannot be removed', async () => {
    storageApi.list.mockResolvedValue({ data: [{ name: '1.png' }], error: null });
    storageApi.remove.mockResolvedValue({ error: { message: 'no permission' } });

    expect(await deleteAllPostImages('user-1')).toEqual({ error: { message: 'no permission' } });
  });
});
