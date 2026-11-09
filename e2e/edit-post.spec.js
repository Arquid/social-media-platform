import { test, expect } from '@playwright/test';
import { API, KEY, createUser, authHeaders } from './api';

// Editing a post, at the level of the database: who may do it, what changes, what is marked.
// (The edit in the browser is tested in post-editing-ui.spec.js.)

const json = { 'Content-Type': 'application/json', Prefer: 'return=representation' };

async function newPost(request, author, content = 'the first version') {
  const response = await request.post(`${API}/rest/v1/posts`, {
    headers: authHeaders(author, json),
    data: { user_id: author.id, content },
  });
  expect(response.status()).toBe(201);
  return (await response.json())[0];
}

const edit = (request, who, postId, data) =>
  request.patch(`${API}/rest/v1/posts?id=eq.${postId}`, { headers: authHeaders(who, json), data });

const feedRow = async (request, who, postId) =>
  (await (await request.get(`${API}/rest/v1/posts_feed?id=eq.${postId}`, { headers: authHeaders(who) })).json())[0];

test.describe('editing a post', () => {
  test('changes the text and marks the post as edited', async ({ request }) => {
    const author = await createUser(request, 'edauth');
    const post = await newPost(request, author);
    expect(post.edited_at).toBeNull();

    const response = await edit(request, author, post.id, { content: 'the second version' });

    expect(response.status()).toBe(200);
    const [updated] = await response.json();
    expect(updated.content).toBe('the second version');
    expect(updated.edited_at).not.toBeNull();
    // Everything else stays as it was
    expect(updated.created_at).toBe(post.created_at);
    expect(updated.user_id).toBe(author.id);
  });

  test('the time of the edit is set by the database, close to now', async ({ request }) => {
    const author = await createUser(request, 'edtime');
    const post = await newPost(request, author);
    const before = Date.now();

    const [updated] = await (await edit(request, author, post.id, { content: 'changed' })).json();

    const editedAt = Date.parse(updated.edited_at);
    expect(editedAt).toBeGreaterThan(before - 5000);
    expect(editedAt).toBeLessThan(Date.now() + 5000);
  });

  test('saving the same text again is not an edit', async ({ request }) => {
    const author = await createUser(request, 'edsame');
    const post = await newPost(request, author, 'unchanged text');

    const [updated] = await (await edit(request, author, post.id, { content: 'unchanged text' })).json();

    expect(updated.edited_at).toBeNull();
  });

  test('every edit moves the time forward', async ({ request }) => {
    const author = await createUser(request, 'edtwice');
    const post = await newPost(request, author);

    const [first] = await (await edit(request, author, post.id, { content: 'one' })).json();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [second] = await (await edit(request, author, post.id, { content: 'two' })).json();

    expect(Date.parse(second.edited_at)).toBeGreaterThan(Date.parse(first.edited_at));
  });

  test('nobody else can edit the post: the change does not happen', async ({ request }) => {
    const author = await createUser(request, 'edowner');
    const stranger = await createUser(request, 'edstranger');
    const post = await newPost(request, author, 'mine');

    const response = await edit(request, stranger, post.id, { content: 'hijacked' });

    // The policy hides the row from the stranger: nothing is found to change
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual([]);
    const after = await feedRow(request, author, post.id);
    expect(after.content).toBe('mine');
    expect(after.edited_at).toBeNull();
  });

  test('a visitor who is not logged in cannot edit', async ({ request }) => {
    const author = await createUser(request, 'edvisit');
    const post = await newPost(request, author, 'safe');

    const response = await request.patch(`${API}/rest/v1/posts?id=eq.${post.id}`, {
      headers: { apikey: KEY, ...json },
      data: { content: 'defaced' },
    });

    expect(response.status()).toBe(401);
    expect((await feedRow(request, author, post.id)).content).toBe('safe');
  });

  test('the author, the time of writing and the time of editing cannot be changed', async ({ request }) => {
    const author = await createUser(request, 'edcols');
    const other = await createUser(request, 'edcolsb');
    const post = await newPost(request, author);

    for (const data of [
      { user_id: other.id },
      { created_at: '2000-01-01T00:00:00Z' },
      { edited_at: '2000-01-01T00:00:00Z' },
      { content: 'ok', edited_at: '2000-01-01T00:00:00Z' }, // the allowed column does not smuggle in the others
    ]) {
      const response = await edit(request, author, post.id, data);
      expect(response.status(), JSON.stringify(data)).toBe(403);
    }
    const after = await feedRow(request, author, post.id);
    expect(after.edited_at).toBeNull();
    expect(after.user_id).toBe(author.id);
  });

  test('the text still has to be 1-500 characters', async ({ request }) => {
    const author = await createUser(request, 'edlen');
    const post = await newPost(request, author, 'a fine text');

    for (const content of ['', 'x'.repeat(501)]) {
      const response = await edit(request, author, post.id, { content });
      expect(response.status(), `${content.length} characters`).toBe(400);
      expect((await response.json()).code).toBe('23514'); // check_violation
    }
    expect((await edit(request, author, post.id, { content: 'x'.repeat(500) })).status()).toBe(200);
  });

  test('keeps the likes and comments of the post', async ({ request }) => {
    const author = await createUser(request, 'edkeep');
    const fan = await createUser(request, 'edkeepfan');
    const post = await newPost(request, author);
    await request.post(`${API}/rest/v1/likes`, { headers: authHeaders(fan, json), data: { post_id: post.id, user_id: fan.id } });
    await request.post(`${API}/rest/v1/comments`, { headers: authHeaders(fan, json), data: { post_id: post.id, user_id: fan.id, content: 'nice' } });

    await edit(request, author, post.id, { content: 'a better version' });

    expect(await feedRow(request, fan, post.id)).toMatchObject({ like_count: 1, comment_count: 1, liked_by_me: true });
  });

  test('is shown in the feed views: the all feed, the following feed and the profile', async ({ request }) => {
    const author = await createUser(request, 'edview');
    const reader = await createUser(request, 'edviewrd');
    const post = await newPost(request, author);
    await request.post(`${API}/rest/v1/follows`, { headers: authHeaders(reader, json), data: { follower_id: reader.id, following_id: author.id } });
    await edit(request, author, post.id, { content: 'edited text' });

    const all = await feedRow(request, reader, post.id);
    const following = (await (await request.get(`${API}/rest/v1/posts_following_feed?id=eq.${post.id}`, { headers: authHeaders(reader) })).json())[0];

    for (const row of [all, following]) {
      expect(row.content).toBe('edited text');
      expect(row.edited_at).not.toBeNull();
    }
  });

  test('a post that was never edited has no edit time in the feed', async ({ request }) => {
    const author = await createUser(request, 'ednever');
    const post = await newPost(request, author);

    expect((await feedRow(request, author, post.id)).edited_at).toBeNull();
  });
});
