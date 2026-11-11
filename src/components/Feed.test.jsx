import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Feed from './Feed';
import { supabase } from '../lib/supabaseClient';
import { renderWithProviders } from '../test/renderWithProviders';
import { createQuery, createChannel, makePosts } from '../test/supabaseMock';
import { logError } from '../lib/errorReporting';

// The real logging is kept (console and all); the test only watches what it is asked to log
vi.mock('../lib/errorReporting', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, logError: vi.fn(actual.logError) };
});

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

// Each supabase.from() call returns the next prepared query
function queueQueries(...queries) {
  const queue = [...queries];
  supabase.from.mockImplementation(() => queue.shift());
}

describe('Feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.channel.mockReturnValue(createChannel());
  });

  it('shows a spinner with a name while the first page loads', async () => {
    queueQueries(createQuery({ data: makePosts(1), error: null }));
    renderWithProviders(<Feed />);

    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
    await screen.findByText('Post 1');
  });

  it('shows the empty state when there are no posts', async () => {
    queueQueries(createQuery({ data: [], error: null }));
    renderWithProviders(<Feed />);

    expect(await screen.findByText('No posts yet.')).toBeInTheDocument();
  });

  it('shows an error message when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    queueQueries(createQuery({ data: null, error: { message: 'network down' } }));
    renderWithProviders(<Feed />);

    expect(await screen.findByText(/could not load posts: network down/i)).toBeInTheDocument();
  });

  it('does not show "Load more" when everything fits on one page', async () => {
    queueQueries(createQuery({ data: makePosts(5), error: null }));
    renderWithProviders(<Feed />);

    expect(await screen.findByText('Post 5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('loads the first page of 20 newest posts', async () => {
    const first = createQuery({ data: makePosts(20, 50), error: null });
    queueQueries(first);
    renderWithProviders(<Feed />);

    expect(await screen.findByText('Post 50')).toBeInTheDocument();
    expect(screen.getByText('Post 31')).toBeInTheDocument();
    expect(supabase.from).toHaveBeenCalledWith('posts_feed');
    expect(first.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(first.limit).toHaveBeenCalledWith(20);
    expect(first.lt).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
  });

  it('loads older posts with a cursor and hides the button on the last page', async () => {
    const first = createQuery({ data: makePosts(20, 50), error: null });
    const second = createQuery({ data: makePosts(5, 30), error: null });
    queueQueries(first, second);
    renderWithProviders(<Feed />);

    await screen.findByText('Post 31');
    await userEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(await screen.findByText('Post 26')).toBeInTheDocument();
    // The cursor is the id of the oldest post that was on screen
    expect(second.lt).toHaveBeenCalledWith('id', 31);
    expect(screen.getAllByText(/^Post \d+$/)).toHaveLength(25);
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('does not show the same post twice if a page overlaps', async () => {
    const first = createQuery({ data: makePosts(20, 50), error: null });
    // Overlaps with the first page on ids 31 and 30
    const second = createQuery({ data: makePosts(3, 31), error: null });
    queueQueries(first, second);
    renderWithProviders(<Feed />);

    await screen.findByText('Post 31');
    await userEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(await screen.findByText('Post 29')).toBeInTheDocument();
    expect(screen.getAllByText('Post 31')).toHaveLength(1);
    expect(screen.getAllByText(/^Post \d+$/)).toHaveLength(22);
  });

  it('shows a toast and keeps the list when "Load more" fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = createQuery({ data: makePosts(20, 50), error: null });
    const second = createQuery({ data: null, error: { message: 'timeout' } });
    queueQueries(first, second);
    renderWithProviders(<Feed />);

    await screen.findByText('Post 31');
    await userEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(await screen.findByText('Could not load more posts: timeout')).toBeInTheDocument();
    expect(logError).toHaveBeenCalledWith('Feed query failed:', { message: 'timeout' });
    expect(screen.getAllByText(/^Post \d+$/)).toHaveLength(20);
    expect(screen.getByRole('button', { name: /load more/i })).toBeEnabled();
  });

  it('filters the feed by author on a profile page', async () => {
    const query = createQuery({ data: makePosts(2), error: null });
    queueQueries(query);
    renderWithProviders(<Feed authorId="author-1" />);

    await screen.findByText('Post 2');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'author-1');
  });

  describe('Following tab', () => {
    // Returns the function the feed registered for one realtime event
    function realtimeHandler(channel, event, table) {
      const call = channel.on.mock.calls.find(([, filter]) => filter.event === event && filter.table === table);
      return call[2];
    }

    it('shows the empty state when the user follows nobody, with one request', async () => {
      queueQueries(createQuery({ data: [], error: null }));
      renderWithProviders(<Feed followingOnly />);

      expect(await screen.findByText('No posts yet.')).toBeInTheDocument();
      expect(supabase.from).toHaveBeenCalledTimes(1);
      expect(supabase.from).toHaveBeenCalledWith('posts_following_feed');
    });

    it('reads the following view and sends no list of ids to the server', async () => {
      const posts = createQuery({ data: makePosts(2), error: null });
      queueQueries(posts);
      renderWithProviders(<Feed followingOnly />);

      await screen.findByText('Post 2');
      expect(supabase.from).toHaveBeenCalledTimes(1);
      expect(supabase.from).toHaveBeenCalledWith('posts_following_feed');
      expect(supabase.from).not.toHaveBeenCalledWith('follows');
      expect(posts.in).not.toHaveBeenCalled();
    });

    it('keeps reading the following view when loading older posts', async () => {
      const first = createQuery({ data: makePosts(20, 50), error: null });
      const second = createQuery({ data: makePosts(5, 30), error: null });
      queueQueries(first, second);
      renderWithProviders(<Feed followingOnly />);

      await screen.findByText('Post 31');
      await userEvent.click(screen.getByRole('button', { name: /load more/i }));

      expect(await screen.findByText('Post 26')).toBeInTheDocument();
      expect(supabase.from).toHaveBeenNthCalledWith(2, 'posts_following_feed');
      expect(second.lt).toHaveBeenCalledWith('id', 31);
    });

    it('adds a new post only if the following view returns it', async () => {
      const channel = createChannel();
      supabase.channel.mockReturnValue(channel);
      const stranger = createQuery({ data: null, error: null });
      const followed = createQuery({ data: makePosts(1, 99)[0], error: null });
      queueQueries(createQuery({ data: makePosts(1), error: null }), stranger, followed);
      renderWithProviders(<Feed followingOnly />);
      await screen.findByText('Post 1');

      const onInsert = realtimeHandler(channel, 'INSERT', 'posts');

      // A post by someone the user does not follow: the view has no row for it
      await act(() => onInsert({ new: { id: 98, user_id: 'stranger' } }));
      expect(supabase.from).toHaveBeenNthCalledWith(2, 'posts_following_feed');
      expect(stranger.eq).toHaveBeenCalledWith('id', 98);
      expect(screen.queryByText('Post 99')).not.toBeInTheDocument();

      // A post by a followed user is added to the top
      await act(() => onInsert({ new: { id: 99, user_id: 'author-1' } }));
      expect(await screen.findByText('Post 99')).toBeInTheDocument();
      expect(supabase.from).toHaveBeenCalledTimes(3);
      expect(supabase.from).not.toHaveBeenCalledWith('follows');
    });

    it('on the All tab a new post is fetched from the normal feed view', async () => {
      const channel = createChannel();
      supabase.channel.mockReturnValue(channel);
      queueQueries(createQuery({ data: makePosts(1), error: null }), createQuery({ data: makePosts(1, 7)[0], error: null }));
      renderWithProviders(<Feed />);
      await screen.findByText('Post 1');

      await act(() => realtimeHandler(channel, 'INSERT', 'posts')({ new: { id: 7, user_id: 'author-1' } }));

      expect(await screen.findByText('Post 7')).toBeInTheDocument();
      expect(supabase.from).toHaveBeenNthCalledWith(2, 'posts_feed');
    });
  });

  describe('a post the user just wrote', () => {
    const postTexts = () => screen.getAllByText(/^Post \d+$/).map((el) => el.textContent);

    // The effect for the new post starts before the one that loads the first page, so its
    // request is the first one: queue it first. The lookup is held back until the test lets it
    // finish, like a request that takes a moment.
    function slowLookup() {
      let finish;
      const answer = new Promise((resolve) => {
        finish = (post) => resolve({ data: post, error: null });
      });
      return { query: createQuery(answer), finish };
    }

    it('is shown at the top at once, without waiting for realtime', async () => {
      const lookup = slowLookup();
      queueQueries(lookup.query, createQuery({ data: makePosts(2), error: null }));
      renderWithProviders(<Feed newPostId={7} />);
      await screen.findByText('Post 2');

      await act(async () => lookup.finish(makePosts(1, 7)[0]));

      expect(screen.getByText('Post 7')).toBeInTheDocument();
      expect(postTexts()).toEqual(['Post 7', 'Post 2', 'Post 1']);
      expect(supabase.from).toHaveBeenNthCalledWith(1, 'posts_feed');
    });

    it('is not shown twice when realtime reports the same post', async () => {
      const channel = createChannel();
      supabase.channel.mockReturnValue(channel);
      const row = makePosts(1, 7)[0];
      const lookup = slowLookup();
      queueQueries(lookup.query, createQuery({ data: makePosts(2), error: null }), createQuery({ data: row, error: null }));
      renderWithProviders(<Feed newPostId={7} />);
      await screen.findByText('Post 2');
      await act(async () => lookup.finish(row));
      expect(screen.getByText('Post 7')).toBeInTheDocument();

      const onInsert = channel.on.mock.calls.find(([, f]) => f.event === 'INSERT' && f.table === 'posts')[2];
      await act(() => onInsert({ new: { id: 7, user_id: 'author-1' } }));

      expect(supabase.from).toHaveBeenCalledTimes(3);
      expect(screen.getAllByText('Post 7')).toHaveLength(1);
    });

    it('is not shown twice when the first page already contains it', async () => {
      const lookup = slowLookup();
      queueQueries(lookup.query, createQuery({ data: makePosts(3, 7), error: null }));
      renderWithProviders(<Feed newPostId={7} />);
      await screen.findByText('Post 5');

      await act(async () => lookup.finish(makePosts(1, 7)[0]));

      expect(postTexts()).toEqual(['Post 7', 'Post 6', 'Post 5']);
    });

    it('does not jump to the top if it is older than the newest post (an old id after a tab switch)', async () => {
      const lookup = slowLookup();
      queueQueries(lookup.query, createQuery({ data: makePosts(3, 50), error: null }));
      renderWithProviders(<Feed newPostId={5} />);
      await screen.findByText('Post 50');

      await act(async () => lookup.finish(makePosts(1, 5)[0]));

      expect(postTexts()).toEqual(['Post 50', 'Post 49', 'Post 48']);
    });

    it('appears in an empty feed', async () => {
      const lookup = slowLookup();
      queueQueries(lookup.query, createQuery({ data: [], error: null }));
      renderWithProviders(<Feed newPostId={7} />);
      await screen.findByText('No posts yet.');

      await act(async () => lookup.finish(makePosts(1, 7)[0]));

      expect(screen.getByText('Post 7')).toBeInTheDocument();
    });

    it('is looked up in the following view on the Following tab, and not shown if it is not there', async () => {
      queueQueries(
        createQuery({ data: null, error: null }),
        createQuery({ data: makePosts(1), error: null })
      );
      renderWithProviders(<Feed followingOnly newPostId={7} />);

      await screen.findByText('Post 1');
      await waitFor(() => expect(supabase.from).toHaveBeenCalledTimes(2));
      expect(supabase.from).toHaveBeenNthCalledWith(1, 'posts_following_feed');
      expect(postTexts()).toEqual(['Post 1']);
    });

    it('is ignored when it cannot be loaded', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      queueQueries(
        createQuery({ data: null, error: { message: 'boom' } }),
        createQuery({ data: makePosts(1), error: null })
      );
      renderWithProviders(<Feed newPostId={7} />);

      await screen.findByText('Post 1');
      await waitFor(() => expect(supabase.from).toHaveBeenCalledTimes(2));
      expect(postTexts()).toEqual(['Post 1']);
      expect(logError).toHaveBeenCalledWith('Post refresh failed:', { message: 'boom' });
    });

    it('does nothing when there is no new post', async () => {
      queueQueries(createQuery({ data: makePosts(1), error: null }));
      renderWithProviders(<Feed />);

      await screen.findByText('Post 1');
      expect(supabase.from).toHaveBeenCalledTimes(1);
    });
  });

  describe('realtime subscriptions', () => {
    let channels;

    // Every supabase.channel() call gets its own fake channel, so the tests can see what each one asked for
    function trackChannels() {
      channels = [];
      supabase.channel.mockImplementation((topic) => {
        const channel = createChannel();
        channel.topic = topic;
        channels.push(channel);
        return channel;
      });
    }

    const activityChannels = () => channels.filter((c) => c.topic.startsWith('feed-activity'));
    const optionsOf = (channel) => channel.on.mock.calls.map(([, options]) => options);
    const handlerOf = (channel, table, event) =>
      channel.on.mock.calls.find(([, o]) => o.table === table && o.event === event)[2];
    // The activity channel is only opened half a second after the posts have arrived
    const waitForActivity = (count = 1, timeout = 3000) =>
      waitFor(() => expect(activityChannels()).toHaveLength(count), { timeout });

    beforeEach(() => {
      trackChannels();
    });

    it('asks only for the likes and comments of the posts on the screen', async () => {
      queueQueries(createQuery({ data: makePosts(3), error: null }));
      renderWithProviders(<Feed />);

      await waitForActivity();

      expect(optionsOf(activityChannels()[0])).toEqual([
        { event: '*', schema: 'public', table: 'likes', filter: 'post_id=in.(3,2,1)' },
        { event: 'INSERT', schema: 'public', table: 'comments', filter: 'post_id=in.(3,2,1)' },
        // The author may edit a post: the filter is on the id of the post, not on post_id
        { event: 'UPDATE', schema: 'public', table: 'posts', filter: 'id=in.(3,2,1)' },
      ]);
    });

    it('shows the new text and the "edited" mark when the author edits a post that is on the screen', async () => {
      queueQueries(
        createQuery({ data: makePosts(2), error: null }),
        createQuery({ data: { ...makePosts(1, 2)[0], content: 'Post 2, better', edited_at: '2026-10-01T10:00:00Z' }, error: null })
      );
      renderWithProviders(<Feed />);
      await waitForActivity();

      await act(() => handlerOf(activityChannels()[0], 'posts', 'UPDATE')({ new: { id: 2 } }));

      expect(await screen.findByText('Post 2, better')).toBeInTheDocument();
      expect(screen.getByText(/· edited/)).toBeInTheDocument();
      expect(screen.queryByText('Post 2')).not.toBeInTheDocument();
    });

    it('never listens to the likes or comments of the whole service', async () => {
      queueQueries(createQuery({ data: makePosts(3), error: null }));
      renderWithProviders(<Feed />);
      await waitForActivity();

      const options = channels.flatMap(optionsOf);
      const unfiltered = options.filter((o) => ['likes', 'comments'].includes(o.table) && !o.filter);
      expect(unfiltered).toEqual([]);
    });

    it('asks for at most the 100 newest posts, the most a filter accepts', async () => {
      queueQueries(createQuery({ data: makePosts(101), error: null }));
      renderWithProviders(<Feed />);
      // Drawing 101 cards is slow when the whole test suite runs at once: wait longer
      await waitForActivity(1, 15_000);

      const { filter } = optionsOf(activityChannels()[0])[0];
      const ids = filter.match(/in\.\((.*)\)/)[1].split(',').map(Number);
      expect(ids).toHaveLength(100);
      expect(ids[0]).toBe(101);
      expect(ids.at(-1)).toBe(2); // the oldest post is left out
    }, 30_000);

    it('does not open the activity channel while there are no posts', async () => {
      queueQueries(createQuery({ data: [], error: null }));
      renderWithProviders(<Feed />);
      await screen.findByText('No posts yet.');
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(activityChannels()).toHaveLength(0);
    });

    it('refreshes a post when somebody likes it, and when somebody takes the like back', async () => {
      queueQueries(
        createQuery({ data: makePosts(2), error: null }),
        createQuery({ data: { ...makePosts(1, 2)[0], like_count: 7 }, error: null }),
        createQuery({ data: { ...makePosts(1, 2)[0], like_count: 6 }, error: null })
      );
      renderWithProviders(<Feed />);
      await waitForActivity();
      const onLike = handlerOf(activityChannels()[0], 'likes', '*');

      await act(() => onLike({ new: { post_id: 2, user_id: 'x' }, old: {} }));
      expect(await screen.findByText('7')).toBeInTheDocument();

      // An unlike only has the old row
      await act(() => onLike({ new: {}, old: { post_id: 2, user_id: 'x' } }));
      expect(await screen.findByText('6')).toBeInTheDocument();
    });

    it('refreshes a post when somebody comments on it', async () => {
      queueQueries(
        createQuery({ data: makePosts(2), error: null }),
        createQuery({ data: { ...makePosts(1, 1)[0], comment_count: 9 }, error: null })
      );
      renderWithProviders(<Feed />);
      await waitForActivity();

      await act(() => handlerOf(activityChannels()[0], 'comments', 'INSERT')({ new: { post_id: 1 } }));

      expect(await screen.findByText('9')).toBeInTheDocument();
    });

    it('subscribes again, once, when a burst of new posts changes the list', async () => {
      queueQueries(
        createQuery({ data: makePosts(2), error: null }),
        createQuery({ data: makePosts(1, 10)[0], error: null }),
        createQuery({ data: makePosts(1, 11)[0], error: null })
      );
      renderWithProviders(<Feed />);
      await waitForActivity();
      const first = activityChannels()[0];
      const feedChannel = channels.find((c) => c.topic.startsWith('feed-') && !c.topic.startsWith('feed-activity'));
      const onInsert = handlerOf(feedChannel, 'posts', 'INSERT');

      await act(() => onInsert({ new: { id: 10, user_id: 'author-1' } }));
      await act(() => onInsert({ new: { id: 11, user_id: 'author-1' } }));
      await screen.findByText('Post 11');
      await waitForActivity(2);

      expect(activityChannels()).toHaveLength(2); // not three: the burst counted as one change
      expect(supabase.removeChannel).toHaveBeenCalledWith(first);
      expect(optionsOf(activityChannels()[1])[0].filter).toBe('post_id=in.(11,10,2,1)');
    });

    it('keeps the subscription when only the numbers of a post change', async () => {
      queueQueries(
        createQuery({ data: makePosts(2), error: null }),
        createQuery({ data: { ...makePosts(1, 2)[0], like_count: 1 }, error: null })
      );
      renderWithProviders(<Feed />);
      await waitForActivity();

      await act(() => handlerOf(activityChannels()[0], 'likes', '*')({ new: { post_id: 2 }, old: {} }));
      await screen.findByText('1');
      await new Promise((resolve) => setTimeout(resolve, 800));

      expect(activityChannels()).toHaveLength(1);
      expect(supabase.removeChannel).not.toHaveBeenCalled();
    });

    it('listens to the new posts of the author only on a profile page', async () => {
      queueQueries(createQuery({ data: makePosts(1), error: null }));
      renderWithProviders(<Feed authorId="author-1" />);
      await screen.findByText('Post 1');

      const postsChannel = channels.find((c) => c.topic.startsWith('feed-') && !c.topic.startsWith('feed-activity'));
      const insert = optionsOf(postsChannel).find((o) => o.event === 'INSERT');
      expect(insert).toMatchObject({ table: 'posts', filter: 'user_id=eq.author-1' });
    });

    it('listens to all new posts on the home page and on the Following tab', async () => {
      for (const followingOnly of [false, true]) {
        trackChannels();
        queueQueries(createQuery({ data: makePosts(1), error: null }));
        const { unmount } = renderWithProviders(<Feed followingOnly={followingOnly} />);
        await screen.findByText('Post 1');

        const postsChannel = channels.find((c) => c.topic.startsWith('feed-') && !c.topic.startsWith('feed-activity'));
        const insert = optionsOf(postsChannel).find((o) => o.event === 'INSERT');
        expect(insert.filter, `followingOnly=${followingOnly}`).toBeUndefined();
        unmount();
      }
    });

    it('still hears about every deleted post: the event has only the id and cannot be filtered', async () => {
      queueQueries(createQuery({ data: makePosts(2), error: null }));
      renderWithProviders(<Feed authorId="author-1" />);
      await screen.findByText('Post 2');

      const postsChannel = channels.find((c) => c.topic.startsWith('feed-') && !c.topic.startsWith('feed-activity'));
      const del = optionsOf(postsChannel).find((o) => o.event === 'DELETE');
      expect(del.filter).toBeUndefined();

      await act(() => handlerOf(postsChannel, 'posts', 'DELETE')({ old: { id: 2 } }));
      expect(screen.queryByText('Post 2')).not.toBeInTheDocument();
    });

    it('closes both channels when it goes away', async () => {
      queueQueries(createQuery({ data: makePosts(2), error: null }));
      const { unmount } = renderWithProviders(<Feed />);
      await waitForActivity();

      unmount();

      for (const channel of channels) expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
      expect(channels).toHaveLength(2);
    });
  });

  it('unsubscribes from realtime when it unmounts', async () => {
    queueQueries(createQuery({ data: makePosts(1), error: null }));
    const { unmount } = renderWithProviders(<Feed />);

    await screen.findByText('Post 1');
    expect(supabase.channel).toHaveBeenCalled();
    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });
});
