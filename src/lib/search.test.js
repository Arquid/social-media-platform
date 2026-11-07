import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchProfiles, MIN_SEARCH_LENGTH, SEARCH_PAGE_SIZE } from './search';
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
    expect(supabase.rpc).toHaveBeenCalledWith('search_profiles', {
      search_text: 'ali',
      result_limit: 20,
      result_offset: 0,
    });
  });

  it('asks for the page that starts after the people already shown', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null });

    await searchProfiles('ali', 40);

    expect(supabase.rpc).toHaveBeenCalledWith('search_profiles', {
      search_text: 'ali',
      result_limit: SEARCH_PAGE_SIZE,
      result_offset: 40,
    });
  });

  it('passes the text on as it is, special characters included (the database handles them)', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null });

    await searchProfiles(`50%_off, (a)\\ "q"`);

    expect(supabase.rpc).toHaveBeenCalledWith('search_profiles', expect.objectContaining({ search_text: `50%_off, (a)\\ "q"` }));
  });

  it('returns the users and no error', async () => {
    supabase.rpc.mockResolvedValue({ data: [alice], error: null });

    expect(await searchProfiles('ali')).toEqual({ users: [alice], error: '', hasMore: false });
  });

  it('says there may be more people when the page is full, and not when it is not', async () => {
    const fullPage = Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) => ({ ...alice, id: `u${i}` }));
    supabase.rpc.mockResolvedValue({ data: fullPage, error: null });
    expect((await searchProfiles('ali')).hasMore).toBe(true);

    supabase.rpc.mockResolvedValue({ data: fullPage.slice(1), error: null });
    expect((await searchProfiles('ali')).hasMore).toBe(false);
  });

  it('returns an empty list when nobody matches', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null });

    expect(await searchProfiles('zzz')).toEqual({ users: [], error: '', hasMore: false });
  });

  it('returns the error message instead of throwing, and logs the error', async () => {
    const error = { code: '42501', message: 'permission denied' };
    supabase.rpc.mockResolvedValue({ data: null, error });

    const result = await searchProfiles('ali');

    expect(result).toEqual({ users: [], error: 'permission denied', hasMore: false });
    expect(console.error).toHaveBeenCalledWith('Search failed:', error);
  });
});
