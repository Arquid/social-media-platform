import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Home from './Home';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders } from '../test/renderWithProviders';
import { createQuery, createChannel, makePosts } from '../test/supabaseMock';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

// Every table has its own queue of prepared queries
function queuePerTable(tables) {
  supabase.from.mockImplementation((table) => tables[table].shift());
}

const postTexts = () => screen.queryAllByText(/^Post \d+$/).map((el) => el.textContent);

async function writePost(text) {
  await userEvent.type(screen.getByPlaceholderText("What's on your mind?"), text);
  await userEvent.click(screen.getByRole('button', { name: 'Post' }));
}

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.channel.mockReturnValue(createChannel());
  });

  it('shows a post the user just wrote at the top of the feed, with no realtime event', async () => {
    queuePerTable({
      posts_feed: [
        createQuery({ data: makePosts(2), error: null }),
        createQuery({ data: makePosts(1, 7)[0], error: null }),
      ],
      posts: [createQuery({ data: { id: 7 }, error: null })],
    });
    renderWithProviders(<Home />);
    await screen.findByText('Post 2');

    await writePost('hello');

    await waitFor(() => expect(postTexts()).toEqual(['Post 7', 'Post 2', 'Post 1']));
  });

  it('shows every post when the user writes two in a row', async () => {
    queuePerTable({
      posts_feed: [
        createQuery({ data: makePosts(1), error: null }),
        createQuery({ data: makePosts(1, 7)[0], error: null }),
        createQuery({ data: makePosts(1, 8)[0], error: null }),
      ],
      posts: [
        createQuery({ data: { id: 7 }, error: null }),
        createQuery({ data: { id: 8 }, error: null }),
      ],
    });
    renderWithProviders(<Home />);
    await screen.findByText('Post 1');

    await writePost('first');
    await screen.findByText('Post 7');
    await writePost('second');

    await waitFor(() => expect(postTexts()).toEqual(['Post 8', 'Post 7', 'Post 1']));
  });

  it('does not show it on the Following tab, because the user does not follow themselves', async () => {
    queuePerTable({
      posts_feed: [createQuery({ data: makePosts(1), error: null })],
      posts_following_feed: [
        createQuery({ data: [], error: null }),
        createQuery({ data: null, error: null }),
      ],
      posts: [createQuery({ data: { id: 7 }, error: null })],
    });
    renderWithProviders(<Home />);
    await screen.findByText('Post 1');
    await userEvent.click(screen.getByRole('tab', { name: 'Following' }));
    await screen.findByText('No posts yet.');

    await writePost('mine');

    await waitFor(() => expect(supabase.from).toHaveBeenCalledTimes(4));
    expect(supabase.from).toHaveBeenLastCalledWith('posts_following_feed');
    expect(screen.getByText('No posts yet.')).toBeInTheDocument();
  });

  it('does not bring an old post to the top again when the tab is switched', async () => {
    queuePerTable({
      posts_feed: [
        createQuery({ data: makePosts(2, 5), error: null }),
        createQuery({ data: makePosts(1, 5)[0], error: null }),
        // After the tab switch the feed is loaded again, and newer posts exist by now.
        // The old post is looked up first (that effect starts before the page is loaded).
        createQuery({ data: makePosts(1, 5)[0], error: null }),
        createQuery({ data: makePosts(3, 20), error: null }),
      ],
      // On the Following tab the post is looked up first as well, and that view does not have it
      posts_following_feed: [
        createQuery({ data: null, error: null }),
        createQuery({ data: [], error: null }),
      ],
      posts: [createQuery({ data: { id: 5 }, error: null })],
    });
    renderWithProviders(<Home />);
    await screen.findByText('Post 4');
    await writePost('x');
    await waitFor(() => expect(supabase.from).toHaveBeenCalledTimes(3));

    await userEvent.click(screen.getByRole('tab', { name: 'Following' }));
    await screen.findByText('No posts yet.');
    await userEvent.click(screen.getByRole('tab', { name: 'All' }));

    await screen.findByText('Post 20');
    await waitFor(() => expect(supabase.from).toHaveBeenCalledTimes(7));
    expect(postTexts()).toEqual(['Post 20', 'Post 19', 'Post 18']);
  });
});
