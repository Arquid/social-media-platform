import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportDialog from './ReportDialog';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

let query;
const onClose = vi.fn();

// A good result is shown as a green message, not in the red of the errors
const kindOf = (text) => screen.getByText(text).closest('[role="alert"]').className.match(/MuiAlert-\w*(Success|Error)/)?.[1];

function open(target = { postId: 7 }, title = 'Report this post') {
  return renderWithProviders(<ReportDialog title={title} target={target} onClose={onClose} />);
}

const sendButton = () => screen.getByRole('button', { name: 'Send report' });
const details = () => screen.getByRole('textbox', { name: 'Details (optional)' });
const choose = (name) => userEvent.click(screen.getByRole('radio', { name }));

beforeEach(() => {
  vi.clearAllMocks();
  query = createQuery({ error: null });
  supabase.from.mockReturnValue(query);
});

describe('ReportDialog', () => {
  it('is a dialog named after what is reported, with a group of reasons that has a name', () => {
    open({ postId: 7 }, 'Report @alice');

    expect(screen.getByRole('dialog', { name: 'Report @alice' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Reason' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.closest('label').textContent)).toEqual([
      'Spam', 'Harassment or bullying', 'Hate speech', 'Violence or threats', 'Something else',
    ]);
    expect(screen.getByText(/your report is private/i)).toBeInTheDocument();
  });

  it('cannot be sent before a reason is chosen, and nothing is chosen for the user', async () => {
    open();

    expect(screen.getAllByRole('radio').every((r) => !r.checked)).toBe(true);
    expect(sendButton()).toBeDisabled();

    await choose('Spam');
    expect(sendButton()).toBeEnabled();
  });

  it('sends the report for a post with the reason and the details, thanks the user and closes', async () => {
    open({ postId: 7 });

    await choose('Harassment or bullying');
    await userEvent.type(details(), 'it is aimed at me');
    await userEvent.click(sendButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(supabase.from).toHaveBeenCalledWith('reports');
    expect(query.insert).toHaveBeenCalledWith({
      reporter_id: TEST_USER.id, post_id: 7, reason: 'harassment', details: 'it is aimed at me',
    });
    expect(await screen.findByText('Thank you. Your report was sent.')).toBeInTheDocument();
    expect(kindOf('Thank you. Your report was sent.')).toBe('Success');
  });

  it('sends a report for a comment and for a person', async () => {
    const comment = open({ commentId: 12 });
    await choose('Hate speech');
    await userEvent.click(sendButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(query.insert).toHaveBeenLastCalledWith({ reporter_id: TEST_USER.id, comment_id: 12, reason: 'hate', details: null });
    comment.unmount();

    open({ userId: 'u9' }, 'Report @bob');
    await choose('Spam');
    await userEvent.click(sendButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    expect(query.insert).toHaveBeenLastCalledWith({ reporter_id: TEST_USER.id, reported_user_id: 'u9', reason: 'spam', details: null });
  });

  it('allows 300 characters of details and no more', () => {
    open();

    expect(details()).toHaveAttribute('maxlength', '300');
  });

  it('says so, and closes, when the same thing was already reported', async () => {
    supabase.from.mockReturnValue(createQuery({ error: { code: '23505', message: 'duplicate key' } }));
    open();

    await choose('Spam');
    await userEvent.click(sendButton());

    expect(await screen.findByText('You have already reported this.')).toBeInTheDocument();
    expect(kindOf('You have already reported this.')).toBe('Success');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the error in the dialog, keeps what was written and lets the user try again', async () => {
    supabase.from.mockReturnValue(createQuery({
      error: { code: 'PT429', message: 'You are sending reports too fast. Please wait a minute and try again.' },
    }));
    open();

    await choose('Violence or threats');
    await userEvent.type(details(), 'details to keep');
    await userEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('You are sending reports too fast.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(details()).toHaveValue('details to keep');
    expect(screen.getByRole('radio', { name: 'Violence or threats' })).toBeChecked();
    expect(sendButton()).toBeEnabled();

    // The next try works, and the old error is gone while it is being sent
    supabase.from.mockReturnValue(createQuery({ error: null }));
    await userEvent.click(sendButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('is locked while the report is on its way: no second report, no Cancel, the dialog stays', async () => {
    let finish;
    query.then = (resolve) => { finish = () => resolve({ error: null }); };
    open();
    await choose('Spam');

    await userEvent.click(sendButton());

    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(query.insert).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes with Cancel and with Escape, and sends nothing', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
