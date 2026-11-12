import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import Profile from './Profile';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: `http://storage.test/${p}` } }) }) },
  },
}));

// The feed and follow button have their own tests; here they are only placeholders
vi.mock('../components/Feed', () => ({ default: ({ authorId }) => <div>Feed of {authorId}</div> }));
vi.mock('../components/FollowButton', () => ({ default: ({ onChange }) => <button onClick={onChange}>Follow</button> }));

const baseProfile = {
  id: 'p-1',
  username: 'alice',
  display_name: 'Alice Smith',
  bio: 'I like cats',
  avatar_path: null,
};

// profiles lookup, the two follower/following counts, and (on somebody else's page) the block
function mockProfile(profile, { followers = 3, following = 5, blocked = false } = {}) {
  supabase.from
    .mockReturnValueOnce(createQuery({ data: profile, error: null }))
    .mockReturnValueOnce(createQuery({ count: followers, error: null }))
    .mockReturnValueOnce(createQuery({ count: following, error: null }));
  if (profile && profile.id !== TEST_USER.id) {
    supabase.from.mockReturnValueOnce(createQuery({ data: blocked ? { blocked_id: profile.id } : null, error: null }));
  }
}

function renderProfile(username = 'alice') {
  return renderWithProviders(
    <Routes>
      <Route path="/profile/:username" element={<Profile />} />
    </Routes>,
    { route: `/profile/${username}` }
  );
}

describe('Profile page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the display name, username, bio and counts', async () => {
    mockProfile(baseProfile);
    renderProfile();

    expect(await screen.findByRole('heading', { level: 1, name: 'Alice Smith' })).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('I like cats')).toBeInTheDocument();
    expect(screen.getByText('followers')).toHaveTextContent('3 followers');
    expect(screen.getByText('following')).toHaveTextContent('5 following');
    expect(screen.getByText('Feed of p-1')).toBeInTheDocument();
  });

  it('falls back to @username when there is no display name', async () => {
    mockProfile({ ...baseProfile, display_name: null, bio: '' });
    renderProfile();

    expect(await screen.findByRole('heading', { level: 1, name: '@alice' })).toBeInTheDocument();
    expect(screen.queryByText('I like cats')).not.toBeInTheDocument();
  });

  it('shows the profile picture when the user has one', async () => {
    mockProfile({ ...baseProfile, avatar_path: 'p-1/me.png' });
    renderProfile();

    const image = await screen.findByRole('img', { name: "alice's avatar" });
    expect(image).toHaveAttribute('src', 'http://storage.test/p-1/me.png');
  });

  it('shows a Follow button, not Edit profile, on someone else\'s profile', async () => {
    mockProfile(baseProfile);
    renderProfile();

    expect(await screen.findByRole('button', { name: 'Follow' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit profile' })).not.toBeInTheDocument();
  });

  it('counts the followers again after you follow somebody', async () => {
    mockProfile(baseProfile, { followers: 3, following: 5 });
    renderProfile();
    expect(await screen.findByText('followers')).toHaveTextContent('3 followers');

    mockProfile(baseProfile, { followers: 4, following: 5 });
    await userEvent.click(screen.getByRole('button', { name: 'Follow' }));

    await vi.waitFor(() => expect(screen.getByText('followers')).toHaveTextContent('4 followers'));
  });

  it('shows the saved profile and closes the dialog after editing', async () => {
    const own = { ...baseProfile, id: TEST_USER.id };
    mockProfile(own);
    renderProfile();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));

    // The dialog saves the profile, then the page loads it again
    const saved = { ...own, display_name: 'Alice Renamed' };
    supabase.from.mockReturnValueOnce(createQuery({ data: saved, error: null }));
    mockProfile(saved);
    const name = screen.getByLabelText('Display name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Alice Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Alice Renamed' })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows a spinner with a name while the profile loads', () => {
    mockProfile(baseProfile);
    renderProfile();

    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
  });

  it('shows Edit profile on your own profile and opens and closes the dialog', async () => {
    mockProfile({ ...baseProfile, id: TEST_USER.id });
    renderProfile();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));
    expect(screen.queryByRole('button', { name: 'Follow' })).not.toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText('Display name')).toHaveValue('Alice Smith');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers account deletion on your own profile only, and opens the confirmation', async () => {
    mockProfile({ ...baseProfile, id: TEST_USER.id });
    const { unmount } = renderProfile();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
    expect(dialog).toHaveTextContent(/permanently deletes/i);
    expect(screen.getByLabelText(/type alice to confirm/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    unmount();

    // Somebody else's profile has no such button
    mockProfile(baseProfile);
    renderProfile();
    await screen.findByRole('heading', { level: 1, name: 'Alice Smith' });
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
  });

  describe('blocking and reporting', () => {
    it('asks the database whether you blocked this person, but not on your own page', async () => {
      mockProfile(baseProfile);
      const { unmount } = renderProfile();
      await screen.findByRole('heading', { level: 1, name: 'Alice Smith' });
      expect(supabase.from.mock.calls.map(([table]) => table)).toEqual(['profiles', 'follows', 'follows', 'blocks']);
      unmount();

      vi.clearAllMocks();
      mockProfile({ ...baseProfile, id: TEST_USER.id });
      renderProfile();
      await screen.findByRole('heading', { level: 1, name: 'Alice Smith' });
      expect(supabase.from.mock.calls.map(([table]) => table)).toEqual(['profiles', 'follows', 'follows']);
    });

    it('on the page of somebody you have not blocked: Follow, Block and Report user, and the feed', async () => {
      mockProfile(baseProfile);
      renderProfile();

      expect(await screen.findByRole('button', { name: 'Follow' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Report user' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Unblock' })).not.toBeInTheDocument();
      expect(screen.getByText('Feed of p-1')).toBeInTheDocument();
    });

    it('on your own page there is no Block and no Report', async () => {
      mockProfile({ ...baseProfile, id: TEST_USER.id });
      renderProfile();

      await screen.findByRole('button', { name: 'Edit profile' });
      expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Report user' })).not.toBeInTheDocument();
    });

    it('on the page of somebody you blocked: a note and Unblock, no Follow, no feed, no Report', async () => {
      mockProfile(baseProfile, { blocked: true });
      renderProfile();

      expect(await screen.findByRole('button', { name: 'Unblock' })).toBeInTheDocument();
      expect(screen.getByText(/you have blocked @alice/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Follow' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Report user' })).not.toBeInTheDocument();
      expect(screen.queryByText('Feed of p-1')).not.toBeInTheDocument();
    });

    it('blocking: after the question the page loads again and shows the note instead of the feed', async () => {
      mockProfile(baseProfile);
      renderProfile();
      await userEvent.click(await screen.findByRole('button', { name: 'Block' }));

      supabase.from.mockReturnValueOnce(createQuery({ error: null })); // the block itself
      mockProfile(baseProfile, { blocked: true });
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Block @alice?' })).getByRole('button', { name: 'Block' }));

      expect(await screen.findByRole('button', { name: 'Unblock' })).toBeInTheDocument();
      expect(screen.getByText(/you have blocked @alice/i)).toBeInTheDocument();
      expect(screen.queryByText('Feed of p-1')).not.toBeInTheDocument();
    });

    it('unblocking: the page loads again and the feed and Follow come back', async () => {
      mockProfile(baseProfile, { blocked: true });
      renderProfile();
      const unblock = await screen.findByRole('button', { name: 'Unblock' });

      supabase.from.mockReturnValueOnce(createQuery({ error: null })); // the unblock itself
      mockProfile(baseProfile);
      await userEvent.click(unblock);

      expect(await screen.findByRole('button', { name: 'Follow' })).toBeInTheDocument();
      expect(screen.getByText('Feed of p-1')).toBeInTheDocument();
      expect(screen.queryByText(/you have blocked/i)).not.toBeInTheDocument();
    });

    it('"Report user" opens the report for this person, and sending it closes the dialog', async () => {
      mockProfile(baseProfile);
      renderProfile();
      await userEvent.click(await screen.findByRole('button', { name: 'Report user' }));

      const report = createQuery({ error: null });
      supabase.from.mockReturnValueOnce(report);
      const dialog = screen.getByRole('dialog', { name: 'Report @alice' });
      await userEvent.click(within(dialog).getByRole('radio', { name: 'Spam' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));

      await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(report.insert).toHaveBeenCalledWith({
        reporter_id: TEST_USER.id, reported_user_id: 'p-1', reason: 'spam', details: null,
      });
    });

    it('the report dialog can be closed without sending anything', async () => {
      mockProfile(baseProfile);
      renderProfile();
      await userEvent.click(await screen.findByRole('button', { name: 'Report user' }));
      const callsBefore = supabase.from.mock.calls.length;

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(supabase.from.mock.calls.length).toBe(callsBefore);
    });
  });

  it('shows "User not found." for an unknown username', async () => {
    supabase.from.mockReturnValueOnce(createQuery({ data: null, error: null }));
    renderProfile('nobody');

    expect(await screen.findByRole('heading', { level: 1, name: 'User not found.' })).toBeInTheDocument();
  });
});
