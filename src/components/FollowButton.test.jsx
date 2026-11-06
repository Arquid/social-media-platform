import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FollowButton from './FollowButton';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders, TEST_USER } from '../test/renderWithProviders';
import { createQuery } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

// The first request asks "do I follow this person?". `action` is the answer to a click on the button
function mockFollowing(isFollowing, action) {
  supabase.from.mockReturnValueOnce(
    createQuery({ data: isFollowing ? { follower_id: TEST_USER.id } : null, error: null })
  );
  if (action) supabase.from.mockReturnValueOnce(action);
}

// Shows the button for one person and lets a test move on to another
function Host() {
  const [target, setTarget] = useState('target-1');
  return (
    <>
      <button onClick={() => setTarget('target-2')}>show the next person</button>
      <FollowButton targetId={target} />
    </>
  );
}

describe('FollowButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks whether the logged-in user already follows this person', async () => {
    mockFollowing(false);
    renderWithProviders(<FollowButton targetId="target-1" />);

    await screen.findByRole('button', { name: 'Follow' });
    const [table] = supabase.from.mock.calls[0];
    const query = supabase.from.mock.results[0].value;
    expect(table).toBe('follows');
    expect(query.match).toHaveBeenCalledWith({ follower_id: TEST_USER.id, following_id: 'target-1' });
  });

  it('shows "Follow" for somebody you do not follow and "Unfollow" for somebody you do', async () => {
    mockFollowing(false);
    const { unmount } = renderWithProviders(<FollowButton targetId="target-1" />);
    expect(await screen.findByRole('button', { name: 'Follow' })).toBeInTheDocument();
    unmount();

    mockFollowing(true);
    renderWithProviders(<FollowButton targetId="target-1" />);
    expect(await screen.findByRole('button', { name: 'Unfollow' })).toBeInTheDocument();
  });

  it('follows, switches to "Unfollow" and tells the page', async () => {
    const insert = createQuery({ error: null });
    mockFollowing(false, insert);
    const onChange = vi.fn();
    renderWithProviders(<FollowButton targetId="target-1" onChange={onChange} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Follow' }));

    expect(insert.insert).toHaveBeenCalledWith({ follower_id: TEST_USER.id, following_id: 'target-1' });
    expect(await screen.findByRole('button', { name: 'Unfollow' })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('unfollows, switches back to "Follow" and tells the page', async () => {
    const remove = createQuery({ error: null });
    mockFollowing(true, remove);
    const onChange = vi.fn();
    renderWithProviders(<FollowButton targetId="target-1" onChange={onChange} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Unfollow' }));

    expect(remove.delete).toHaveBeenCalled();
    expect(remove.match).toHaveBeenCalledWith({ follower_id: TEST_USER.id, following_id: 'target-1' });
    expect(await screen.findByRole('button', { name: 'Follow' })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('works without an onChange function', async () => {
    mockFollowing(false, createQuery({ error: null }));
    renderWithProviders(<FollowButton targetId="target-1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Follow' }));

    expect(await screen.findByRole('button', { name: 'Unfollow' })).toBeInTheDocument();
  });

  it.each([
    ['follow', false, 'Follow', 'Could not follow user: no permission'],
    ['unfollow', true, 'Unfollow', 'Could not unfollow user: no permission'],
  ])('keeps the button and shows a toast when trying to %s fails', async (_action, startsFollowing, label, message) => {
    mockFollowing(startsFollowing, createQuery({ error: { message: 'no permission' } }));
    const onChange = vi.fn();
    renderWithProviders(<FollowButton targetId="target-1" onChange={onChange} />);

    await userEvent.click(await screen.findByRole('button', { name: label }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forgets the answer of the first request if the page was left in the meantime', async () => {
    let answer;
    supabase.from.mockReturnValueOnce(createQuery(new Promise((resolve) => { answer = resolve; })));
    const { unmount } = renderWithProviders(<FollowButton targetId="target-1" />);

    unmount();
    await act(async () => answer({ data: { follower_id: TEST_USER.id }, error: null }));

    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('asks again when the page shows somebody else', async () => {
    mockFollowing(false);
    renderWithProviders(<Host />);
    await screen.findByRole('button', { name: 'Follow' });
    expect(supabase.from).toHaveBeenCalledTimes(1);

    mockFollowing(true); // the next person is already followed
    await userEvent.click(screen.getByRole('button', { name: 'show the next person' }));

    expect(await screen.findByRole('button', { name: 'Unfollow' })).toBeInTheDocument();
    const second = supabase.from.mock.results[1].value;
    expect(second.match).toHaveBeenCalledWith({ follower_id: TEST_USER.id, following_id: 'target-2' });
  });
});
