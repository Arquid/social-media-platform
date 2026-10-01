import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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
vi.mock('../components/FollowButton', () => ({ default: () => <button>Follow</button> }));

const baseProfile = {
  id: 'p-1',
  username: 'alice',
  display_name: 'Alice Smith',
  bio: 'I like cats',
  avatar_path: null,
};

// profiles lookup, then the two follower/following counts
function mockProfile(profile, { followers = 3, following = 5 } = {}) {
  supabase.from
    .mockReturnValueOnce(createQuery({ data: profile, error: null }))
    .mockReturnValueOnce(createQuery({ count: followers, error: null }))
    .mockReturnValueOnce(createQuery({ count: following, error: null }));
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

    expect(await screen.findByRole('heading', { name: 'Alice Smith' })).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('I like cats')).toBeInTheDocument();
    expect(screen.getByText('followers')).toHaveTextContent('3 followers');
    expect(screen.getByText('following')).toHaveTextContent('5 following');
    expect(screen.getByText('Feed of p-1')).toBeInTheDocument();
  });

  it('falls back to @username when there is no display name', async () => {
    mockProfile({ ...baseProfile, display_name: null, bio: '' });
    renderProfile();

    expect(await screen.findByRole('heading', { name: '@alice' })).toBeInTheDocument();
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

  it('shows "User not found." for an unknown username', async () => {
    supabase.from.mockReturnValueOnce(createQuery({ data: null, error: null }));
    renderProfile('nobody');

    expect(await screen.findByText('User not found.')).toBeInTheDocument();
  });
});
