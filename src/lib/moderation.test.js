import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  REPORT_REASONS, MAX_REPORT_DETAILS, fetchIsBlocked, blockUser, unblockUser, sendReport,
} from './moderation';
import { supabase } from './supabaseClient';
import { createQuery } from '../test/supabaseMock';

vi.mock('./supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the reasons for a report', () => {
  it('are the five that the database accepts, in the order the form shows them', () => {
    expect(REPORT_REASONS.map((r) => r.value)).toEqual(['spam', 'harassment', 'hate', 'violence', 'other']);
    for (const { label } of REPORT_REASONS) expect(label.length).toBeGreaterThan(3);
  });

  it('allow 300 characters of details, like the database', () => {
    expect(MAX_REPORT_DETAILS).toBe(300);
  });
});

describe('fetchIsBlocked', () => {
  it('asks for the one block between the two people', async () => {
    const query = createQuery({ data: { blocked_id: 'u2' }, error: null });
    supabase.from.mockReturnValue(query);

    expect(await fetchIsBlocked('u1', 'u2')).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('blocks');
    expect(query.match).toHaveBeenCalledWith({ blocker_id: 'u1', blocked_id: 'u2' });
  });

  it('says no when there is no block', async () => {
    supabase.from.mockReturnValue(createQuery({ data: null, error: null }));

    expect(await fetchIsBlocked('u1', 'u2')).toBe(false);
  });
});

describe('blockUser and unblockUser', () => {
  it('add a block in the name of the blocker', async () => {
    const query = createQuery({ error: null });
    supabase.from.mockReturnValue(query);

    const result = await blockUser('u1', 'u2');

    expect(supabase.from).toHaveBeenCalledWith('blocks');
    expect(query.insert).toHaveBeenCalledWith({ blocker_id: 'u1', blocked_id: 'u2' });
    expect(result.error).toBeNull();
  });

  it('give back the error of the database', async () => {
    supabase.from.mockReturnValue(createQuery({ error: { code: 'PT429', message: 'too fast' } }));

    expect((await blockUser('u1', 'u2')).error).toMatchObject({ message: 'too fast' });
  });

  it('remove only that block', async () => {
    const query = createQuery({ error: null });
    supabase.from.mockReturnValue(query);

    const result = await unblockUser('u1', 'u2');

    expect(supabase.from).toHaveBeenCalledWith('blocks');
    expect(query.delete).toHaveBeenCalled();
    expect(query.match).toHaveBeenCalledWith({ blocker_id: 'u1', blocked_id: 'u2' });
    expect(result.error).toBeNull();
  });
});

describe('sendReport', () => {
  const inserted = () => supabase.from.mock.results[0].value.insert.mock.calls[0][0];

  beforeEach(() => {
    supabase.from.mockReturnValue(createQuery({ error: null }));
  });

  it('reports a post by its id only: the database finds out who wrote it', async () => {
    const result = await sendReport('me', { postId: 7 }, 'spam', 'buy now');

    expect(supabase.from).toHaveBeenCalledWith('reports');
    expect(inserted()).toStrictEqual({ reporter_id: 'me', post_id: 7, reason: 'spam', details: 'buy now' });
    expect(result).toEqual({ error: null, alreadyReported: false });
  });

  it('reports a comment by its id only', async () => {
    await sendReport('me', { commentId: 12 }, 'hate', '');

    expect(inserted()).toStrictEqual({ reporter_id: 'me', comment_id: 12, reason: 'hate', details: null });
  });

  it('reports a person by their id', async () => {
    await sendReport('me', { userId: 'u9' }, 'harassment', '');

    expect(inserted()).toStrictEqual({ reporter_id: 'me', reported_user_id: 'u9', reason: 'harassment', details: null });
  });

  it('trims the details, and sends nothing for details that are only spaces', async () => {
    await sendReport('me', { postId: 7 }, 'other', '  it hurts  ');
    expect(inserted().details).toBe('it hurts');

    supabase.from.mockClear();
    supabase.from.mockReturnValue(createQuery({ error: null }));
    await sendReport('me', { postId: 7 }, 'other', '   ');
    expect(inserted().details).toBeNull();
  });

  it('is not an error to report the same thing again: it says so', async () => {
    supabase.from.mockReturnValue(createQuery({ error: { code: '23505', message: 'duplicate key value' } }));

    expect(await sendReport('me', { postId: 7 }, 'spam', '')).toEqual({ error: null, alreadyReported: true });
  });

  it('gives back every other error', async () => {
    const error = { code: 'PT429', message: 'You are sending reports too fast.' };
    supabase.from.mockReturnValue(createQuery({ error }));

    expect(await sendReport('me', { postId: 7 }, 'spam', '')).toEqual({ error, alreadyReported: false });
  });
});
