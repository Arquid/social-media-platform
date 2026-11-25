import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminReports from './AdminReports';
import {
  fetchIsAdmin, fetchReports, fetchOpenReportCount, resolveReport,
} from '../lib/moderation';
import { renderWithProviders } from '../test/renderWithProviders';
import { installFakeIntersectionObserver } from '../test/fakeIntersectionObserver';

// The real module is used for the reasons; it must not make a Supabase client, which needs the settings of a project
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }));
vi.mock('../lib/moderation', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchIsAdmin: vi.fn(),
  fetchReports: vi.fn(),
  fetchOpenReportCount: vi.fn(),
  resolveReport: vi.fn(),
  // A page of three, not twenty: a page of twenty cards is slow to draw when the whole suite runs at once.
  // (That the real size is twenty is tested with the library.)
  REPORTS_PAGE_SIZE: 3,
}));

const report = (overrides = {}) => ({
  id: 1,
  created_at: '2026-11-20T10:00:00Z',
  reason: 'spam',
  details: null,
  content_snapshot: 'Buy my stuff',
  reporter_username: 'rita',
  reported_user_id: 'u9',
  reported_username: 'sam',
  post_id: 7,
  comment_id: null,
  content_exists: true,
  other_reports: 0,
  handled_at: null,
  handled_by_username: null,
  resolution: null,
  handler_note: null,
  ...overrides,
});

// `count` reports, newest first, the newest having the id `newest`
const many = (count, newest) => Array.from({ length: count }, (_, i) => report({ id: newest - i, reporter_username: `rep${newest - i}` }));

const kindOf = (text) => screen.getByText(text).closest('[role="alert"]').className.match(/MuiAlert-\w*(Success|Error)/)?.[1];
const card = (name) => screen.getByText(`@${name}`).closest('.MuiPaper-root');

function show(reports = [report()], { count = 3 } = {}) {
  fetchIsAdmin.mockResolvedValue(true);
  fetchReports.mockResolvedValue({ data: reports, error: null });
  fetchOpenReportCount.mockResolvedValue({ count, error: null });
  resolveReport.mockResolvedValue({ error: null });
  return renderWithProviders(<AdminReports />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('who sees the page', () => {
  it('shows a spinner with a name while it finds out who is asking, and asks for no report yet', () => {
    fetchIsAdmin.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<AdminReports />);

    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
    expect(fetchReports).not.toHaveBeenCalled();
  });

  it('shows the page of an unknown address to somebody who is not an administrator, and asks for no report', async () => {
    fetchIsAdmin.mockResolvedValue(false);
    renderWithProviders(<AdminReports />);

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(fetchReports).not.toHaveBeenCalled();
    expect(fetchOpenReportCount).not.toHaveBeenCalled();
  });

  it('has a heading for the page, and the two tabs, with the number of open reports', async () => {
    show([report()], { count: 12 });

    expect(await screen.findByText('Buy my stuff')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Open (12)', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Handled', selected: false })).toBeInTheDocument();
    expect(fetchReports).toHaveBeenCalledWith('open');
  });

  it('shows the tab without a number when the count cannot be read', async () => {
    fetchIsAdmin.mockResolvedValue(true);
    fetchReports.mockResolvedValue({ data: [report()], error: null });
    fetchOpenReportCount.mockResolvedValue({ count: 0, error: { message: 'no' } });
    renderWithProviders(<AdminReports />);

    expect(await screen.findByRole('tab', { name: 'Open' })).toBeInTheDocument();
  });
});

describe('a report', () => {
  it('says who reported whom, why, the copy of the text, and links to the person and the post', async () => {
    show([report({ details: 'it is spam', other_reports: 0 })]);

    await screen.findByText('Buy my stuff');
    const shown = card('rita');
    expect(shown).toHaveTextContent('Spam');
    expect(shown).toHaveTextContent('@rita reported a post by @sam');
    expect(within(shown).getByRole('link', { name: '@sam' })).toHaveAttribute('href', '/profile/sam');
    expect(within(shown).getByRole('link', { name: 'Open the post' })).toHaveAttribute('href', '/post/7');
    expect(shown).toHaveTextContent('it is spam');
    expect(shown).toHaveTextContent('Buy my stuff');
    expect(within(shown).getByRole('time')).toBeInTheDocument();
  });

  it('names what is reported: a comment, or the person', async () => {
    show([
      report({ id: 2, reporter_username: 'carl', post_id: null, comment_id: 4, content_snapshot: 'a bad comment' }),
      report({ id: 3, reporter_username: 'pia', post_id: null, comment_id: null, content_snapshot: null, reason: 'harassment' }),
    ]);

    await screen.findByText('a bad comment');
    expect(card('carl')).toHaveTextContent('@carl reported a comment by @sam');
    expect(within(card('carl')).queryByRole('link', { name: 'Open the post' })).not.toBeInTheDocument();
    expect(card('pia')).toHaveTextContent('@pia reported the person @sam');
    expect(card('pia')).toHaveTextContent('Harassment or bullying');
  });

  it('tells how many other open reports there are about the same thing', async () => {
    show([report({ id: 1, other_reports: 1 }), report({ id: 2, reporter_username: 'two', other_reports: 4 }), report({ id: 3, reporter_username: 'none' })]);

    await screen.findByText('@none');
    expect(card('rita')).toHaveTextContent('1 other open report');
    expect(card('rita')).not.toHaveTextContent('1 other open reports');
    expect(card('two')).toHaveTextContent('4 other open reports');
    expect(card('none')).not.toHaveTextContent('other open');
  });

  it('says that the post has been removed, and offers no removing of it', async () => {
    show([report({ content_exists: false })]);

    await screen.findByText('Buy my stuff');
    expect(card('rita')).toHaveTextContent('The post has been removed.');
    expect(screen.queryByRole('link', { name: 'Open the post' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('keeps long text inside the card: it wraps', async () => {
    show([report({ content_snapshot: 'x'.repeat(400) })]);

    const text = await screen.findByText('x'.repeat(400));
    expect(getComputedStyle(text.parentElement).overflowWrap).toBe('anywhere');
  });
});

describe('the empty page and the errors', () => {
  it('says that there is nothing to do', async () => {
    show([], { count: 0 });

    expect(await screen.findByText('No open reports.')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows the error when the reports cannot be loaded, and no list', async () => {
    fetchIsAdmin.mockResolvedValue(true);
    fetchReports.mockResolvedValue({ data: [], error: { message: 'network down' } });
    fetchOpenReportCount.mockResolvedValue({ count: 0, error: null });
    renderWithProviders(<AdminReports />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the reports: network down');
    expect(screen.queryByText('No open reports.')).not.toBeInTheDocument();
  });
});

describe('handling a report', () => {
  const type = (text) => userEvent.type(screen.getByRole('textbox', { name: 'Note (optional)' }), text);

  it('"Dismiss" sends the note, thanks the user in green and loads the list again', async () => {
    show([report()]);
    await screen.findByText('Buy my stuff');
    fetchReports.mockResolvedValue({ data: [], error: null });
    await type('looks fine');

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(resolveReport).toHaveBeenCalledWith(1, 'dismissed', 'looks fine');
    expect(await screen.findByText('Report handled.')).toBeInTheDocument();
    expect(kindOf('Report handled.')).toBe('Success');
    expect(await screen.findByText('No open reports.')).toBeInTheDocument();
    expect(fetchReports).toHaveBeenCalledTimes(2);
    expect(fetchOpenReportCount).toHaveBeenCalledTimes(2);
  });

  it('"Mark as handled" is a "noted"', async () => {
    show([report()]);
    await screen.findByText('Buy my stuff');

    await userEvent.click(screen.getByRole('button', { name: 'Mark as handled' }));

    expect(resolveReport).toHaveBeenCalledWith(1, 'noted', '');
  });

  it('asks twice before a post is removed: the first button removes nothing, Cancel goes back', async () => {
    show([report()]);
    await screen.findByText('Buy my stuff');

    await userEvent.click(screen.getByRole('button', { name: 'Remove post' }));

    expect(resolveReport).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Remove post' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Remove post' })).toBeInTheDocument();
    expect(resolveReport).not.toHaveBeenCalled();
  });

  it('removes the post after the second question, with the note', async () => {
    show([report()]);
    await screen.findByText('Buy my stuff');
    await type('against the rules');

    await userEvent.click(screen.getByRole('button', { name: 'Remove post' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove the post' }));

    expect(resolveReport).toHaveBeenCalledWith(1, 'content_removed', 'against the rules');
    expect(await screen.findByText('Report handled.')).toBeInTheDocument();
  });

  it('a comment can be removed too, and a person cannot', async () => {
    show([
      report({ id: 2, reporter_username: 'carl', post_id: null, comment_id: 4 }),
      report({ id: 3, reporter_username: 'pia', post_id: null, comment_id: null, content_snapshot: null }),
    ]);
    await screen.findByText('@carl');

    expect(within(card('carl')).getByRole('button', { name: 'Remove comment' })).toBeInTheDocument();
    expect(within(card('pia')).queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    await userEvent.click(within(card('carl')).getByRole('button', { name: 'Remove comment' }));
    await userEvent.click(within(card('carl')).getByRole('button', { name: 'Yes, remove the comment' }));
    expect(resolveReport).toHaveBeenCalledWith(2, 'content_removed', '');
  });

  it('keeps the note of each report apart', async () => {
    show([report({ id: 1 }), report({ id: 2, reporter_username: 'two' })]);
    await screen.findByText('@two');

    await userEvent.type(within(card('two')).getByRole('textbox', { name: 'Note (optional)' }), 'second');
    await userEvent.click(within(card('rita')).getByRole('button', { name: 'Dismiss' }));

    expect(resolveReport).toHaveBeenCalledWith(1, 'dismissed', '');
  });

  it('allows 300 characters in the note, like the database', async () => {
    show([report()]);

    expect(await screen.findByRole('textbox', { name: 'Note (optional)' })).toHaveAttribute('maxlength', '300');
  });

  it('shows the reason in red when it fails, and does not load the list again', async () => {
    show([report()]);
    await screen.findByText('Buy my stuff');
    resolveReport.mockResolvedValue({ error: { message: 'This report has already been handled.' } });

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(await screen.findByText('Could not handle the report: This report has already been handled.')).toBeInTheDocument();
    expect(kindOf('Could not handle the report: This report has already been handled.')).toBe('Error');
    expect(fetchReports).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Buy my stuff')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled();
  });

  it('locks the buttons and the note of that report while it works: one click, one handling', async () => {
    show([report({ id: 1 }), report({ id: 2, reporter_username: 'two' })]);
    await screen.findByText('@two');
    let finish;
    resolveReport.mockReturnValue(new Promise((resolve) => { finish = () => resolve({ error: null }); }));

    await userEvent.click(within(card('rita')).getByRole('button', { name: 'Dismiss' }));

    for (const button of within(card('rita')).getAllByRole('button')) expect(button).toBeDisabled();
    expect(within(card('rita')).getByRole('textbox')).toBeDisabled();
    expect(within(card('two')).getByRole('button', { name: 'Dismiss' })).toBeEnabled();
    expect(resolveReport).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });
});

describe('the handled reports', () => {
  it('switches to them with the tab, and shows how each was handled instead of buttons', async () => {
    show([report()]);
    await screen.findByText('Buy my stuff');
    fetchReports.mockResolvedValue({
      data: [report({
        id: 9, reporter_username: 'old', handled_at: '2026-11-21T10:00:00Z', handled_by_username: 'boss',
        resolution: 'content_removed', handler_note: 'against the rules',
      })],
      error: null,
    });

    await userEvent.click(screen.getByRole('tab', { name: 'Handled' }));

    expect(await screen.findByText('@old')).toBeInTheDocument();
    expect(fetchReports).toHaveBeenLastCalledWith('handled');
    expect(card('old')).toHaveTextContent('Content removed by @boss');
    expect(card('old')).toHaveTextContent(': against the rules');
    expect(within(card('old')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(card('old')).queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Handled', selected: true })).toBeInTheDocument();
  });

  it('says so when the one who handled it has deleted the account, and when there was no note', async () => {
    fetchIsAdmin.mockResolvedValue(true);
    fetchOpenReportCount.mockResolvedValue({ count: 0, error: null });
    fetchReports.mockResolvedValueOnce({ data: [], error: null });
    renderWithProviders(<AdminReports />);
    await screen.findByText('No open reports.');
    fetchReports.mockResolvedValue({
      data: [report({ handled_at: '2026-11-21T10:00:00Z', handled_by_username: null, resolution: 'dismissed' })],
      error: null,
    });

    await userEvent.click(screen.getByRole('tab', { name: 'Handled' }));

    expect(await screen.findByText(/Dismissed by @a removed account/)).toBeInTheDocument();
    expect(screen.getByText(/Dismissed by/).textContent).not.toContain(':'); // no note: nothing after the time
  });

  it('has its own words for an empty list, and shows a spinner while the tab changes', async () => {
    show([report()]);
    await screen.findByText('Buy my stuff');
    let answer;
    fetchReports.mockReturnValue(new Promise((resolve) => { answer = resolve; }));

    await userEvent.click(screen.getByRole('tab', { name: 'Handled' }));

    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('Buy my stuff')).not.toBeInTheDocument();
    await act(async () => answer({ data: [], error: null }));
    expect(await screen.findByText('Nothing has been handled yet.')).toBeInTheDocument();
  });

  it('ignores the answer of a tab that has been left', async () => {
    show([report()]);
    await screen.findByText('Buy my stuff');
    let slow;
    fetchReports.mockReturnValueOnce(new Promise((resolve) => { slow = resolve; }));
    await userEvent.click(screen.getByRole('tab', { name: 'Handled' }));
    fetchReports.mockResolvedValue({ data: [report({ id: 5, reporter_username: 'newer' })], error: null });
    await userEvent.click(screen.getByRole('tab', { name: 'Open (3)' }));
    await screen.findByText('@newer');

    await act(async () => slow({ data: [report({ id: 6, reporter_username: 'late' })], error: null }));

    expect(screen.queryByText('@late')).not.toBeInTheDocument();
    expect(screen.getByText('@newer')).toBeInTheDocument();
  });
});

describe('pages', () => {
  const loadMoreButton = () => screen.queryByRole('button', { name: 'Load more' });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the next page by itself when the button comes near the screen', async () => {
    const scroll = installFakeIntersectionObserver();
    show(many(3, 6));
    await screen.findByText('@rep6');
    fetchReports.mockResolvedValue({ data: many(2, 3), error: null });

    await scroll.comeNearTheScreen();

    expect(await screen.findByText('@rep2')).toBeInTheDocument();
    expect(fetchReports).toHaveBeenLastCalledWith('open', 4);
  });

  it('stops loading by itself after an error, until the button is pressed', async () => {
    const scroll = installFakeIntersectionObserver();
    show(many(3, 6));
    await screen.findByText('@rep6');
    fetchReports.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve({ data: [], error: { message: 'timeout' } }), 10);
    }));

    await scroll.comeNearTheScreen();
    expect(await screen.findByText('Could not load more reports: timeout')).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 30); }); });
    await waitFor(() => expect(scroll.watching()).toHaveLength(0));

    fetchReports.mockResolvedValue({ data: many(2, 3), error: null });
    await userEvent.click(loadMoreButton());
    expect(await screen.findByText('@rep2')).toBeInTheDocument();
  });

  it('offers more only when the first page was full', async () => {
    const { unmount } = show(many(2, 2));
    await screen.findByText('@rep2');
    expect(loadMoreButton()).not.toBeInTheDocument();
    unmount();

    show(many(3, 3));
    await screen.findByText('@rep3');
    expect(loadMoreButton()).toBeInTheDocument();
  });

  it('loads the reports after the last one that is shown, and adds them below, none twice', async () => {
    show(many(3, 6));
    await screen.findByText('@rep6');
    fetchReports.mockResolvedValue({ data: [...many(1, 4), ...many(1, 3)], error: null }); // the first one is already shown

    await userEvent.click(loadMoreButton());

    expect(await screen.findByText('@rep3')).toBeInTheDocument();
    expect(fetchReports).toHaveBeenLastCalledWith('open', 4);
    expect(screen.getAllByText('@rep4')).toHaveLength(1);
    expect(loadMoreButton()).not.toBeInTheDocument();
  });

  it('shows the reason when a page cannot be loaded, and keeps what is shown and the button', async () => {
    show(many(3, 6));
    await screen.findByText('@rep6');
    fetchReports.mockResolvedValue({ data: [], error: { message: 'timeout' } });

    await userEvent.click(loadMoreButton());

    expect(await screen.findByText('Could not load more reports: timeout')).toBeInTheDocument();
    expect(screen.getAllByText(/^@rep\d+$/)).toHaveLength(3);
    await waitFor(() => expect(loadMoreButton()).toBeEnabled());
  });
});
