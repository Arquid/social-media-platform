import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeleteAccountDialog from './DeleteAccountDialog';
import { supabase } from '../lib/supabaseClient';
import { deleteAllAvatars } from '../lib/avatars';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { rpc: vi.fn() },
}));
vi.mock('../lib/avatars', () => ({ deleteAllAvatars: vi.fn() }));

// The order of the first steps matters (the picture can only be removed while the account exists),
// so everything that happens is written down here
let log;
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}));

const confirmButton = () => screen.getByRole('button', { name: 'Delete account' });
const box = () => screen.getByLabelText(/type alice to confirm/i);

function setup() {
  const onClose = vi.fn();
  const signOut = vi.fn(async () => {
    log.push('signOut');
  });
  renderWithProviders(<DeleteAccountDialog username="alice" onClose={onClose} />, { signOut });
  return { onClose, signOut };
}

async function confirmAndDelete(text = 'alice') {
  await userEvent.type(box(), text);
  await userEvent.click(confirmButton());
}

describe('DeleteAccountDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    log = [];
    deleteAllAvatars.mockImplementation(async () => {
      log.push('pictures');
      return {};
    });
    supabase.rpc.mockImplementation(async () => {
      log.push('rpc');
      return { error: null };
    });
    navigate.mockImplementation(() => log.push('navigate'));
  });

  it('warns about what is lost and asks for the username', () => {
    setup();

    expect(screen.getByRole('dialog', { name: 'Delete your account?' })).toHaveTextContent(
      /profile, posts, comments, likes, follows, notifications and profile picture/i
    );
    expect(box()).toHaveFocus();
  });

  it('cannot be confirmed until the exact username has been typed', async () => {
    setup();
    expect(confirmButton()).toBeDisabled();

    await userEvent.type(box(), 'alic');
    expect(confirmButton()).toBeDisabled();

    await userEvent.clear(box());
    await userEvent.type(box(), 'Alice'); // letter case counts
    expect(confirmButton()).toBeDisabled();

    await userEvent.clear(box());
    await userEvent.type(box(), 'alice');
    expect(confirmButton()).toBeEnabled();
  });

  it('removes the pictures, then deletes the account, then leaves the page and logs out', async () => {
    const { signOut } = setup();

    await confirmAndDelete();

    await vi.waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(deleteAllAvatars).toHaveBeenCalledWith(TEST_USER.id);
    expect(supabase.rpc).toHaveBeenCalledWith('delete_my_account');
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
    // The picture first: after the account is gone there is no login any more to remove it with
    expect(log.slice(0, 2)).toEqual(['pictures', 'rpc']);
    expect(log.slice(2).sort()).toEqual(['navigate', 'signOut']);
  });

  it('tells the user the account is gone', async () => {
    setup();

    await confirmAndDelete();

    expect(await screen.findByText('Your account has been deleted.')).toBeInTheDocument();
  });

  it('does not delete the account when the picture cannot be removed', async () => {
    deleteAllAvatars.mockResolvedValue({ error: { message: 'storage down' } });
    const { signOut } = setup();

    await confirmAndDelete();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove your profile picture: storage down');
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(box()).toHaveValue('alice');
    expect(confirmButton()).toBeEnabled();
  });

  it('stays on the page and logged in when the database refuses', async () => {
    supabase.rpc.mockResolvedValue({ error: { message: 'something went wrong' } });
    const { signOut } = setup();

    await confirmAndDelete();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete the account: something went wrong');
    expect(navigate).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(confirmButton()).toBeEnabled();
  });

  it('can be tried again after an error, and the old error goes away', async () => {
    supabase.rpc
      .mockResolvedValueOnce({ error: { message: 'network down' } })
      .mockResolvedValueOnce({ error: null });
    const { signOut } = setup();

    await confirmAndDelete();
    await screen.findByRole('alert');
    await userEvent.click(confirmButton());

    await vi.waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is locked while the deletion is on its way: one request, no cancel, no closing', async () => {
    let finish;
    supabase.rpc.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { onClose } = setup();

    await confirmAndDelete();

    expect(confirmButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(box()).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => finish({ error: null }));
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('Cancel closes the dialog and deletes nothing', async () => {
    const { onClose } = setup();
    await userEvent.type(box(), 'alice');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
    expect(deleteAllAvatars).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
