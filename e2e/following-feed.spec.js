import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { API, KEY, createUser, authHeaders, createProfilesInBulk, runSql, waitForRealtimeToCatchUp } from './api';
import { newUser, signUp, postCard } from './helpers';

// The Following tab reads the posts_following_feed view. The database decides whose posts are
// included, so the browser no longer sends a list of followed ids in the address of the request.
// That used to fail at about 400 followed people (HTTP 414) and was cut at 1000 (row limit).

const tag = () => randomBytes(3).toString('hex');

// Creates `count` authors named "<prefix>_1" ... with one post each ("<marker> <username>"), and
// makes `followerId` follow all of them. Triggers are off to keep the load fast and quiet.
function createFollowedAuthors({ prefix, count, marker, followerId }) {
  createProfilesInBulk(prefix, count);
  runSql(`
    set session_replication_role = replica;
    insert into posts (user_id, content)
      select id, '${marker} ' || username from profiles where username like '${prefix}\\_%';
    insert into follows (follower_id, following_id)
      select '${followerId}', id from profiles where username like '${prefix}\\_%';
  `);
}

function followingFeed(request, user, query = 'order=id.desc&limit=20', headers = {}) {
  return request.get(`${API}/rest/v1/posts_following_feed?${query}`, { headers: authHeaders(user, headers) });
}

test.describe('following feed (database view)', () => {
  test('works for a user who follows more people than the old limits allowed', async ({ request }) => {
    const me = await createUser(request, 'ffbig');
    const prefix = `fb${tag()}`;
    createFollowedAuthors({ prefix, count: 1100, marker: 'big-follow', followerId: me.id });

    // The old request listed every followed id in the address: far too long at 1100
    const page = await followingFeed(request, me);
    expect(page.status()).toBe(200);
    const rows = await page.json();
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.content.startsWith('big-follow'))).toBe(true);

    // All 1100 posts are reachable: the list of followed people was cut at 1000 before
    const counted = await followingFeed(request, me, 'select=id&limit=1', { Prefer: 'count=exact' });
    expect(counted.headers()['content-range']).toMatch(/\/1100$/);
  });

  test('contains only posts of followed people, with the usual feed columns', async ({ request }) => {
    const me = await createUser(request, 'ffme');
    const followed = await createUser(request, 'fffol');
    const stranger = await createUser(request, 'ffstr');
    runSql(`
      set session_replication_role = replica;
      insert into follows (follower_id, following_id) values ('${me.id}', '${followed.id}');
      insert into posts (user_id, content) values
        ('${followed.id}', 'followed post'), ('${stranger.id}', 'stranger post'), ('${me.id}', 'my own post');
      insert into likes (post_id, user_id) select id, '${me.id}' from posts where content = 'followed post';
    `);

    const rows = await (await followingFeed(request, me)).json();

    expect(rows.map((row) => row.content)).toEqual(['followed post']);
    expect(rows[0]).toMatchObject({
      user_id: followed.id, username: followed.username, like_count: 1, comment_count: 0, liked_by_me: true,
    });
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['avatar_path', 'comment_count', 'content', 'created_at', 'display_name', 'edited_at', 'id', 'like_count', 'liked_by_me', 'user_id', 'username']
    );
  });

  test('is personal: someone who follows nobody gets an empty list', async ({ request }) => {
    const follower = await createUser(request, 'ffa');
    const loner = await createUser(request, 'ffb');
    const author = await createUser(request, 'ffc');
    runSql(`
      set session_replication_role = replica;
      insert into follows (follower_id, following_id) values ('${follower.id}', '${author.id}');
      insert into posts (user_id, content) values ('${author.id}', 'personal feed post');
    `);

    expect(await (await followingFeed(request, follower)).json()).toHaveLength(1);
    expect(await (await followingFeed(request, loner)).json()).toEqual([]);
  });

  test('stops showing a person after unfollowing and pages with a cursor', async ({ request }) => {
    const me = await createUser(request, 'ffcur');
    const author = await createUser(request, 'ffaut');
    runSql(`
      set session_replication_role = replica;
      insert into follows (follower_id, following_id) values ('${me.id}', '${author.id}');
      insert into posts (user_id, content) select '${author.id}', 'cursor post ' || g from generate_series(1, 25) g;
    `);

    const first = await (await followingFeed(request, me)).json();
    expect(first).toHaveLength(20);
    const oldest = first[first.length - 1].id;
    const second = await (await followingFeed(request, me, `order=id.desc&limit=20&id=lt.${oldest}`)).json();
    expect(second).toHaveLength(5);
    expect(second.every((row) => row.id < oldest)).toBe(true);

    const unfollow = await request.delete(`${API}/rest/v1/follows?follower_id=eq.${me.id}&following_id=eq.${author.id}`, {
      headers: authHeaders(me),
    });
    expect(unfollow.ok()).toBe(true);
    expect(await (await followingFeed(request, me)).json()).toEqual([]);
  });

  test('is not available without logging in', async ({ request }) => {
    const response = await request.get(`${API}/rest/v1/posts_following_feed?limit=1`, { headers: { apikey: KEY } });

    expect([401, 403]).toContain(response.status());
  });
});

test('the Following tab shows the posts of 450 followed people and loads more', async ({ page }) => {
  const user = newUser('ffui');
  await signUp(page, user);
  const userId = runSql(`select id from profiles where username = '${user.username}';`).trim();
  createFollowedAuthors({ prefix: `fu${tag()}`, count: 450, marker: 'ui-follow', followerId: userId });
  // The 450 new posts are reported by Realtime a moment later: wait, so that they do not arrive at the page
  // after it has loaded the first 20 and add themselves to the list
  await waitForRealtimeToCatchUp();

  await page.goto('/');
  await page.getByRole('tab', { name: 'Following' }).click();

  await expect(postCard(page, 'ui-follow')).toHaveCount(20);
  await expect(page.getByText(/could not load/i)).toHaveCount(0);

  await page.getByRole('button', { name: /load more/i }).click();
  await expect(postCard(page, 'ui-follow')).toHaveCount(40);
});
