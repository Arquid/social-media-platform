import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  REPORT_REASONS, MAX_REPORT_DETAILS, REPORTS_PAGE_SIZE, fetchIsBlocked, blockUser, unblockUser, sendReport,
  fetchIsAdmin, fetchReports, fetchOpenReportCount, resolveReport,
} from './moderation';
import { supabase } from './supabaseClient';
import { deletePostImage } from './postImages';
import { createQuery } from '../test/supabaseMock';

vi.mock('./supabaseClient', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));
vi.mock('./postImages', () => ({ deletePostImage: vi.fn() }));

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

describe('fetchIsAdmin', () => {
  it('asks the database, and says yes only for a plain true', async () => {
    supabase.rpc.mockResolvedValue({ data: true, error: null });
    expect(await fetchIsAdmin()).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('is_admin');

    supabase.rpc.mockResolvedValue({ data: false, error: null });
    expect(await fetchIsAdmin()).toBe(false);
    supabase.rpc.mockResolvedValue({ data: 'true', error: null });
    expect(await fetchIsAdmin()).toBe(false);
    supabase.rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchIsAdmin()).toBe(false);
  });

  it('says no when the question fails: nobody becomes an administrator by an error', async () => {
    supabase.rpc.mockResolvedValue({ data: true, error: { message: 'boom' } });

    expect(await fetchIsAdmin()).toBe(false);
  });
});

describe('fetchReports', () => {
  it('asks for a page of the open or the handled reports, from the start or after the last one', async () => {
    supabase.rpc.mockResolvedValue({ data: [{ id: 5 }], error: null });

    const first = await fetchReports('open');
    await fetchReports('handled', 42);

    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'admin_list_reports', { p_status: 'open', p_limit: REPORTS_PAGE_SIZE, p_before: null });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'admin_list_reports', { p_status: 'handled', p_limit: REPORTS_PAGE_SIZE, p_before: 42 });
    expect(first).toEqual({ data: [{ id: 5 }], error: null });
    expect(REPORTS_PAGE_SIZE).toBe(20);
  });

  it('gives an empty list, and the error, when it fails', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'Only an administrator can do that.' } });

    expect(await fetchReports('open')).toEqual({ data: [], error: { message: 'Only an administrator can do that.' } });
  });
});

describe('fetchOpenReportCount', () => {
  it('gives the number, and the error', async () => {
    supabase.rpc.mockResolvedValue({ data: 7, error: null });
    expect(await fetchOpenReportCount()).toEqual({ count: 7, error: null });
    expect(supabase.rpc).toHaveBeenCalledWith('admin_open_report_count');

    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'no' } });
    expect(await fetchOpenReportCount()).toEqual({ count: 0, error: { message: 'no' } });
  });
});

describe('resolveReport', () => {
  it('hands the report, the way it is handled and the trimmed note to the database', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await resolveReport(12, 'dismissed', '  looks fine  ');

    expect(supabase.rpc).toHaveBeenCalledWith('admin_resolve_report', { p_report_id: 12, p_resolution: 'dismissed', p_note: 'looks fine' });
    expect(result).toEqual({ error: null });
  });

  it('sends no note when there is none, or only spaces', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    await resolveReport(1, 'noted', '   ');
    await resolveReport(2, 'noted', undefined);

    expect(supabase.rpc.mock.calls.map(([, args]) => args.p_note)).toEqual([null, null]);
  });

  it('removes the file of the picture of a post that was removed', async () => {
    supabase.rpc.mockResolvedValue({ data: 'user-1/17.png', error: null });

    await resolveReport(3, 'content_removed');

    expect(deletePostImage).toHaveBeenCalledWith('user-1/17.png');
  });

  it('has no file to remove for a post without a picture, or a comment (the helper is given nothing)', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    await resolveReport(3, 'content_removed');

    expect(deletePostImage).toHaveBeenCalledWith(null);
  });

  it('gives the error back and touches no file when it fails', async () => {
    supabase.rpc.mockResolvedValue({ data: 'user-1/17.png', error: { message: 'This report has already been handled.' } });

    const result = await resolveReport(3, 'content_removed');

    expect(result).toEqual({ error: { message: 'This report has already been handled.' } });
    expect(deletePostImage).not.toHaveBeenCalled();
  });
});
