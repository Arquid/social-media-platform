import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlockButton from './BlockButton';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

const onChange = vi.fn();
let query;

// A good result is shown as a green message, not in the red of the errors
const kindOf = (text) => screen.getByText(text).closest('[role="alert"]').className.match(/MuiAlert-\w*(Success|Error)/)?.[1];

function show(blocked = false) {
  return renderWithProviders(<BlockButton targetId="u2" username="bob" blocked={blocked} onChange={onChange} />);
}

const openDialog = () => userEvent.click(screen.getByRole('button', { name: 'Block' }));
const confirm = () => userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Block' }));

beforeEach(() => {
  vi.clearAllMocks();
  query = createQuery({ error: null });
  supabase.from.mockReturnValue(query);
});

describe('BlockButton, for somebody who is not blocked', () => {
  it('only asks at first: nothing is blocked before the user confirms', async () => {
    show();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await openDialog();

    const dialog = screen.getByRole('dialog', { name: 'Block @bob?' });
    expect(dialog).toHaveTextContent(/no longer see their posts, comments or notifications/i);
    expect(dialog).toHaveTextContent(/no longer like, comment on or follow you/i);
    expect(dialog).toHaveTextContent(/unblock them any time/i);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('blocks after the confirmation, tells the user, closes the dialog and tells the page', async () => {
    show();
    await openDialog();

    await confirm();

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(supabase.from).toHaveBeenCalledWith('blocks');
    expect(query.insert).toHaveBeenCalledWith({ blocker_id: TEST_USER.id, blocked_id: 'u2' });
    expect(await screen.findByText('Blocked @bob.')).toBeInTheDocument();
    expect(kindOf('Blocked @bob.')).toBe('Success');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does nothing when the user cancels', async () => {
    show();
    await openDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(supabase.from).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes the question with Escape too, and blocks nobody', async () => {
    show();
    await openDialog();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('shows the reason when blocking fails, and does not tell the page', async () => {
    supabase.from.mockReturnValue(createQuery({ error: { message: 'You are blocking too fast.' } }));
    show();
    await openDialog();

    await confirm();

    expect(await screen.findByText('Could not block user: You are blocking too fast.')).toBeInTheDocument();
    expect(kindOf('Could not block user: You are blocking too fast.')).toBe('Error');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText('Blocked @bob.')).not.toBeInTheDocument();
    // The button is there for another try
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument();
  });

  it('is locked while the block is on its way: one block only, and no way to leave the dialog', async () => {
    let finish;
    query.then = (resolve) => { finish = () => resolve({ error: null }); };
    show();
    await openDialog();

    await confirm();

    const dialog = screen.getByRole('dialog');
    for (const button of dialog.querySelectorAll('button')) expect(button).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(query.insert).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });
});

describe('BlockButton, for somebody who is blocked', () => {
  it('offers only "Unblock" and needs no question', () => {
    show(true);

    expect(screen.getByRole('button', { name: 'Unblock' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument();
  });

  it('removes that block, tells the user and the page', async () => {
    show(true);

    await userEvent.click(screen.getByRole('button', { name: 'Unblock' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(supabase.from).toHaveBeenCalledWith('blocks');
    expect(query.delete).toHaveBeenCalled();
    expect(query.match).toHaveBeenCalledWith({ blocker_id: TEST_USER.id, blocked_id: 'u2' });
    expect(await screen.findByText('Unblocked @bob.')).toBeInTheDocument();
    expect(kindOf('Unblocked @bob.')).toBe('Success');
  });

  it('shows the reason when unblocking fails', async () => {
    supabase.from.mockReturnValue(createQuery({ error: { message: 'network down' } }));
    show(true);

    await userEvent.click(screen.getByRole('button', { name: 'Unblock' }));

    expect(await screen.findByText('Could not unblock user: network down')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Unblock' })).toBeEnabled();
  });

  it('cannot be clicked twice while it works', async () => {
    let finish;
    query.then = (resolve) => { finish = () => resolve({ error: null }); };
    show(true);

    await userEvent.click(screen.getByRole('button', { name: 'Unblock' }));

    expect(screen.getByRole('button', { name: 'Unblock' })).toBeDisabled();
    expect(query.delete).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });
});
