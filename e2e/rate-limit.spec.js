import { test, expect } from '@playwright/test';
import { API, createUser, authHeaders, ageRateLimitEvents } from './api';

// These tests call the API directly to prove that the database enforces the limits,
// no matter what the web app does:  10 posts and 20 comments per minute per user.

const POST_LIMIT = 10;
const COMMENT_LIMIT = 20;
const json = { 'Content-Type': 'application/json', Prefer: 'return=representation' };

const addPost = (request, user, content = 'a post') =>
  request.post(`${API}/rest/v1/posts`, { headers: authHeaders(user, json), data: { user_id: user.id, content } });

const addComment = (request, user, postId, content = 'a comment') =>
  request.post(`${API}/rest/v1/comments`, {
    headers: authHeaders(user, json),
    data: { post_id: postId, user_id: user.id, content },
  });

// Posts or comments until the limit is reached. Returns the responses.
async function repeat(count, action) {
  const responses = [];
  for (let i = 0; i < count; i += 1) responses.push(await action(i));
  return responses;
}

const countOk = (responses) => responses.filter((r) => r.ok()).length;

test.describe('post rate limit', () => {
  test('the 11th post within a minute is refused with HTTP 429', async ({ request }) => {
    const user = await createUser(request, 'poster');

    const first = await repeat(POST_LIMIT, (i) => addPost(request, user, `post ${i + 1}`));
    expect(countOk(first)).toBe(POST_LIMIT);

    const refused = await addPost(request, user, 'one too many');
    expect(refused.status()).toBe(429);
    expect(await refused.json()).toMatchObject({
      code: 'PT429',
      message: 'You are posting too fast. Please wait a minute and try again.',
    });
  });

  test('the refused post is not stored', async ({ request }) => {
    const user = await createUser(request, 'poster');
    await repeat(POST_LIMIT, () => addPost(request, user));
    await addPost(request, user, 'one too many');

    const stored = await request.get(`${API}/rest/v1/posts?user_id=eq.${user.id}&select=content`, {
      headers: authHeaders(user),
    });
    const contents = (await stored.json()).map((p) => p.content);
    expect(contents).toHaveLength(POST_LIMIT);
    expect(contents).not.toContain('one too many');
  });

  test('the limit is per user: someone else can still post', async ({ request }) => {
    const spammer = await createUser(request, 'spammer');
    const other = await createUser(request, 'other');
    await repeat(POST_LIMIT, () => addPost(request, spammer));
    expect((await addPost(request, spammer)).status()).toBe(429);

    expect((await addPost(request, other)).ok()).toBe(true);
  });

  test('deleting posts does not give the quota back', async ({ request }) => {
    const user = await createUser(request, 'churner');
    const created = await repeat(POST_LIMIT, () => addPost(request, user));
    for (const response of created) {
      const [post] = await response.json();
      await request.delete(`${API}/rest/v1/posts?id=eq.${post.id}`, { headers: authHeaders(user) });
    }

    expect((await addPost(request, user)).status()).toBe(429);
  });

  test('after a minute the user can post again', async ({ request }) => {
    const user = await createUser(request, 'patient');
    await repeat(POST_LIMIT, () => addPost(request, user));
    expect((await addPost(request, user)).status()).toBe(429);

    ageRateLimitEvents();

    expect((await addPost(request, user)).ok()).toBe(true);
  });

  test('posts that fail for another reason do not use up the quota', async ({ request }) => {
    const user = await createUser(request, 'typo');

    // An empty post is refused by the database (content must be 1-500 characters)
    const bad = await repeat(POST_LIMIT + 2, () => addPost(request, user, ''));
    for (const response of bad) {
      expect(response.status()).toBe(400);
    }

    // The full quota is still available
    const good = await repeat(POST_LIMIT, () => addPost(request, user));
    expect(countOk(good)).toBe(POST_LIMIT);
  });

  test('parallel requests cannot get around the limit', async ({ request }) => {
    const user = await createUser(request, 'parallel');

    const responses = await Promise.all(Array.from({ length: 15 }, (_, i) => addPost(request, user, `parallel ${i}`)));

    expect(countOk(responses)).toBe(POST_LIMIT);
    expect(responses.filter((r) => r.status() === 429)).toHaveLength(15 - POST_LIMIT);
  });

  test('a bulk insert over the limit is refused as a whole', async ({ request }) => {
    const user = await createUser(request, 'bulk');

    const response = await request.post(`${API}/rest/v1/posts`, {
      headers: authHeaders(user, json),
      data: Array.from({ length: POST_LIMIT + 2 }, (_, i) => ({ user_id: user.id, content: `bulk ${i}` })),
    });
    expect(response.status()).toBe(429);

    const stored = await request.get(`${API}/rest/v1/posts?user_id=eq.${user.id}&select=id`, {
      headers: authHeaders(user),
    });
    expect(await stored.json()).toEqual([]);
  });

  test('a user cannot clear their own action log to get around the limit', async ({ request }) => {
    const user = await createUser(request, 'sneaky');
    await repeat(POST_LIMIT, () => addPost(request, user));

    // The table is closed to the app: nothing can be read, deleted or added
    const read = await request.get(`${API}/rest/v1/rate_limit_events?select=id`, { headers: authHeaders(user) });
    expect(await read.json()).toEqual([]);

    await request.delete(`${API}/rest/v1/rate_limit_events?user_id=eq.${user.id}`, { headers: authHeaders(user) });
    const fake = await request.post(`${API}/rest/v1/rate_limit_events`, {
      headers: authHeaders(user, json),
      data: { user_id: user.id, kind: 'post', created_at: '2000-01-01T00:00:00Z' },
    });
    expect(fake.ok()).toBe(false);

    expect((await addPost(request, user)).status()).toBe(429);
  });

  test('setting an old date on a post does not get around the limit', async ({ request }) => {
    const user = await createUser(request, 'oldtime');

    const responses = await repeat(POST_LIMIT + 1, (i) =>
      request.post(`${API}/rest/v1/posts`, {
        headers: authHeaders(user, json),
        data: { user_id: user.id, content: `old ${i}`, created_at: '2000-01-01T00:00:00Z' },
      })
    );

    expect(countOk(responses)).toBe(POST_LIMIT);
    expect(responses.at(-1).status()).toBe(429);
  });
});

test.describe('comment rate limit', () => {
  async function postToCommentOn(request) {
    const author = await createUser(request, 'author');
    const [post] = await (await addPost(request, author)).json();
    return post.id;
  }

  test('the 21st comment within a minute is refused with HTTP 429', async ({ request }) => {
    const postId = await postToCommentOn(request);
    const talker = await createUser(request, 'talker');

    const first = await repeat(COMMENT_LIMIT, (i) => addComment(request, talker, postId, `comment ${i + 1}`));
    expect(countOk(first)).toBe(COMMENT_LIMIT);

    const refused = await addComment(request, talker, postId, 'one too many');
    expect(refused.status()).toBe(429);
    expect(await refused.json()).toMatchObject({
      code: 'PT429',
      message: 'You are commenting too fast. Please wait a minute and try again.',
    });
  });

  test('comments and posts have separate quotas', async ({ request }) => {
    const postId = await postToCommentOn(request);
    const user = await createUser(request, 'both');

    // Use up all comments: posting is still possible
    await repeat(COMMENT_LIMIT, () => addComment(request, user, postId));
    expect((await addComment(request, user, postId)).status()).toBe(429);
    expect((await addPost(request, user)).ok()).toBe(true);

    // Use up all posts (one is already made): commenting is still blocked by its own limit only
    const other = await createUser(request, 'other');
    await repeat(POST_LIMIT, () => addPost(request, other));
    expect((await addPost(request, other)).status()).toBe(429);
    expect((await addComment(request, other, postId)).ok()).toBe(true);
  });

  test('after a minute the user can comment again', async ({ request }) => {
    const postId = await postToCommentOn(request);
    const user = await createUser(request, 'patient');
    await repeat(COMMENT_LIMIT, () => addComment(request, user, postId));
    expect((await addComment(request, user, postId)).status()).toBe(429);

    ageRateLimitEvents();

    expect((await addComment(request, user, postId)).ok()).toBe(true);
  });
});

test.describe('normal use is not affected', () => {
  test('liking, following and notifications still work for a user at the post limit', async ({ request }) => {
    const user = await createUser(request, 'busy');
    const friend = await createUser(request, 'friend');
    const [friendPost] = await (await addPost(request, friend)).json();
    await repeat(POST_LIMIT, () => addPost(request, user));
    expect((await addPost(request, user)).status()).toBe(429);

    const like = await request.post(`${API}/rest/v1/likes`, {
      headers: authHeaders(user, json),
      data: { post_id: friendPost.id, user_id: user.id },
    });
    expect(like.ok()).toBe(true);

    const notifications = await request.get(`${API}/rest/v1/notifications?select=type`, { headers: authHeaders(friend) });
    expect(await notifications.json()).toEqual([{ type: 'like' }]);
  });
});
