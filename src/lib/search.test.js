import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchProfiles, MIN_SEARCH_LENGTH } from './search';
import { supabase } from './supabaseClient';

vi.mock('./supabaseClient', () => ({
  supabase: { rpc: vi.fn() },
}));

const alice = { id: 'a', username: 'alice', display_name: 'Alice', bio: '', avatar_path: null };

describe('searchProfiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('needs at least 2 characters, like the database', () => {
    expect(MIN_SEARCH_LENGTH).toBe(2);
  });

  it('calls the search_profiles function in the database with the text', async () => {
    supabase.rpc.mockResolvedValue({ data: [alice], error: null });

    await searchProfiles('ali');

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('search_profiles', { search_text: 'ali' });
  });

  it('passes the text on as it is, special characters included (the database handles them)', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null });

    await searchProfiles(`50%_off, (a)\\ "q"`);

    expect(supabase.rpc).toHaveBeenCalledWith('search_profiles', { search_text: `50%_off, (a)\\ "q"` });
  });

  it('returns the users and no error', async () => {
    supabase.rpc.mockResolvedValue({ data: [alice], error: null });

    expect(await searchProfiles('ali')).toEqual({ users: [alice], error: '' });
  });

  it('returns an empty list when nobody matches', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null });

    expect(await searchProfiles('zzz')).toEqual({ users: [], error: '' });
  });

  it('returns the error message instead of throwing, and logs the error', async () => {
    const error = { code: '42501', message: 'permission denied' };
    supabase.rpc.mockResolvedValue({ data: null, error });

    const result = await searchProfiles('ali');

    expect(result).toEqual({ users: [], error: 'permission denied' });
    expect(console.error).toHaveBeenCalledWith('Search failed:', error);
  });
});
