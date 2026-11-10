import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeleteAccountDialog from './DeleteAccountDialog';
import { supabase } from '../lib/supabaseClient';
import { deleteAllAvatars } from '../lib/avatars';
import { deleteAllPostImages } from '../lib/postImages';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { rpc: vi.fn() },
}));
vi.mock('../lib/avatars', () => ({ deleteAllAvatars: vi.fn() }));
vi.mock('../lib/postImages', () => ({ deleteAllPostImages: vi.fn() }));

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
    deleteAllPostImages.mockImplementation(async () => {
      log.push('postImages');
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
    expect(log.slice(0, 3)).toEqual(['pictures', 'postImages', 'rpc']);
    expect(log.slice(3).sort()).toEqual(['navigate', 'signOut']);
    expect(deleteAllPostImages).toHaveBeenCalledWith(TEST_USER.id);
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

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove your pictures: storage down');
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(box()).toHaveValue('alice');
    expect(confirmButton()).toBeEnabled();
  });

  it('does not delete the account when the pictures of the posts cannot be removed', async () => {
    deleteAllPostImages.mockResolvedValue({ error: { message: 'post pictures are stuck' } });
    const { signOut } = setup();

    await confirmAndDelete();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove your pictures: post pictures are stuck');
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(confirmButton()).toBeEnabled();
  });

  it('stops at the first failure: if the avatar cannot be removed the pictures of the posts are left alone', async () => {
    deleteAllAvatars.mockResolvedValue({ error: { message: 'storage down' } });
    setup();

    await confirmAndDelete();

    await screen.findByRole('alert');
    expect(deleteAllPostImages).not.toHaveBeenCalled();
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
