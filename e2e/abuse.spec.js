import { test, expect } from '@playwright/test';
import { API, KEY, createUser, createProfilesInBulk, authHeaders, ageRateLimitEvents, runSql } from './api';

// Protection against abuse, checked straight against the database (no web page): rate limits for
// likes, follows, blocks and reports; blocking people; reporting posts, comments and people.

const json = { 'Content-Type': 'application/json', Prefer: 'return=representation' };
const plain = { 'Content-Type': 'application/json' };

const post = (request, user, table, data, headers = plain) =>
  request.post(`${API}/rest/v1/${table}`, { headers: authHeaders(user, headers), data });
const get = (request, user, path) => request.get(`${API}/rest/v1/${path}`, { headers: authHeaders(user) });
const del = (request, user, path) => request.delete(`${API}/rest/v1/${path}`, { headers: authHeaders(user) });

const like = (request, user, postId) => post(request, user, 'likes', { post_id: postId, user_id: user.id });
const comment = (request, user, postId, content = 'a comment') =>
  post(request, user, 'comments', { post_id: postId, user_id: user.id, content });
const follow = (request, user, otherId) => post(request, user, 'follows', { follower_id: user.id, following_id: otherId });
const block = (request, user, otherId) => post(request, user, 'blocks', { blocker_id: user.id, blocked_id: otherId });
const unblock = (request, user, otherId) => del(request, user, `blocks?blocker_id=eq.${user.id}&blocked_id=eq.${otherId}`);
const report = (request, user, data) => post(request, user, 'reports', { reason: 'spam', ...data, reporter_id: user.id });

async function addPost(request, user, content = 'a post') {
  const response = await post(request, user, 'posts', { user_id: user.id, content }, json);
  expect(response.ok()).toBe(true);
  return (await response.json())[0];
}

async function ids(request, user, table, filter, column = 'id') {
  const response = await get(request, user, `${table}?${filter}&select=${column}`);
  return (await response.json()).map((row) => row[column]);
}

// Many posts at once, past the rate limit of posts (the limit is not what is tested here)
async function bulkPosts(request, author, count) {
  runSql(`
    set session_replication_role = replica;
    insert into posts (user_id, content) select '${author.id}', 'bulk ' || g from generate_series(1, ${count}) g;
  `);
  return ids(request, author, 'posts', `user_id=eq.${author.id}&order=id`);
}

// Many other users at once, past the limit of sign ups
function bulkUsers(prefix, count) {
  createProfilesInBulk(prefix, count);
  return runSql(`select id from profiles where username like '${prefix}\\_%' order by username;`)
    .split('\n').map((line) => line.trim()).filter(Boolean);
}

const prefixOf = () => `ab${Math.random().toString(36).slice(2, 8)}`;
const countOk = (responses) => responses.filter((r) => r.ok()).length;

test.describe('rate limits of likes and follows', () => {
  test('the 61st like within a minute is refused with HTTP 429, and the refused like is not stored', async ({ request }) => {
    const author = await createUser(request, 'author');
    const fan = await createUser(request, 'fan');
    const postIds = await bulkPosts(request, author, 61);

    const responses = [];
    for (const id of postIds.slice(0, 60)) responses.push(await like(request, fan, id));
    expect(countOk(responses)).toBe(60);

    const refused = await like(request, fan, postIds[60]);
    expect(refused.status()).toBe(429);
    expect(await refused.json()).toMatchObject({ code: 'PT429', message: 'You are liking too fast. Please wait a minute and try again.' });
    expect(await ids(request, fan, 'likes', `user_id=eq.${fan.id}`, 'post_id')).toHaveLength(60);
  });

  test('liking and unliking again and again does not give the quota back', async ({ request }) => {
    const author = await createUser(request, 'author');
    const fan = await createUser(request, 'fan');
    const [postId] = await bulkPosts(request, author, 1);

    for (let i = 0; i < 60; i += 1) {
      expect((await like(request, fan, postId)).ok()).toBe(true);
      await del(request, fan, `likes?post_id=eq.${postId}&user_id=eq.${fan.id}`);
    }

    expect((await like(request, fan, postId)).status()).toBe(429);
  });

  test('the 31st follow within a minute is refused with HTTP 429', async ({ request }) => {
    const me = await createUser(request, 'follower');
    const targets = bulkUsers(prefixOf(), 31);

    const responses = [];
    for (const id of targets.slice(0, 30)) responses.push(await follow(request, me, id));
    expect(countOk(responses)).toBe(30);

    const refused = await follow(request, me, targets[30]);
    expect(refused.status()).toBe(429);
    expect(await refused.json()).toMatchObject({ code: 'PT429', message: 'You are following too fast. Please wait a minute and try again.' });
  });

  test('the limits are per user and per kind, and the quota comes back after a minute', async ({ request }) => {
    const author = await createUser(request, 'author');
    const fan = await createUser(request, 'fan');
    const other = await createUser(request, 'other');
    const postIds = await bulkPosts(request, author, 61);
    for (const id of postIds.slice(0, 60)) await like(request, fan, id);
    expect((await like(request, fan, postIds[60])).status()).toBe(429);

    // someone else is not affected, and a different kind of action is not either
    expect((await like(request, other, postIds[60])).ok()).toBe(true);
    expect((await comment(request, fan, postIds[60])).ok()).toBe(true);

    ageRateLimitEvents();
    expect((await like(request, fan, postIds[60])).ok()).toBe(true);
  });
});

test.describe('blocking', () => {
  test('a user can block and unblock someone, and sees their own blocks only', async ({ request }) => {
    const [a, b, c] = [await createUser(request, 'a'), await createUser(request, 'b'), await createUser(request, 'c')];

    expect((await block(request, a, b.id)).status()).toBe(201);
    expect(await ids(request, a, 'blocks', `blocker_id=eq.${a.id}`, 'blocked_id')).toEqual([b.id]);
    // The blocked user, and everybody else, cannot see it
    expect(await ids(request, b, 'blocks', `blocked_id=eq.${b.id}`, 'blocker_id')).toEqual([]);
    expect(await ids(request, c, 'blocks', 'select=blocker_id', 'blocker_id')).toEqual([]);

    expect((await unblock(request, a, b.id)).ok()).toBe(true);
    expect(await ids(request, a, 'blocks', `blocker_id=eq.${a.id}`, 'blocked_id')).toEqual([]);
  });

  test('nobody can block in another name, block themselves, block twice or delete the blocks of others', async ({ request }) => {
    const [a, b, c] = [await createUser(request, 'a'), await createUser(request, 'b'), await createUser(request, 'c')];

    expect((await post(request, c, 'blocks', { blocker_id: a.id, blocked_id: b.id })).status()).toBe(403);
    expect((await block(request, a, a.id)).status()).toBe(400);
    expect((await block(request, a, b.id)).ok()).toBe(true);
    expect((await block(request, a, b.id)).status()).toBe(409);

    await del(request, c, `blocks?blocker_id=eq.${a.id}`);
    expect(await ids(request, a, 'blocks', `blocker_id=eq.${a.id}`, 'blocked_id')).toEqual([b.id]);
  });

  test('a visitor who is not logged in cannot use blocks at all', async ({ request }) => {
    const read = await request.get(`${API}/rest/v1/blocks?select=*`, { headers: { apikey: KEY } });
    expect([401, 403]).toContain(read.status());
    const write = await request.post(`${API}/rest/v1/blocks`, { headers: { apikey: KEY, ...plain }, data: { blocker_id: 'x', blocked_id: 'y' } });
    expect([401, 403]).toContain(write.status());
  });

  test('the blocked user cannot like, comment on or follow the blocker: HTTP 403, nothing stored', async ({ request }) => {
    const [a, b] = [await createUser(request, 'blocker'), await createUser(request, 'blocked')];
    const mine = await addPost(request, a);
    await block(request, a, b.id);

    for (const response of [await like(request, b, mine.id), await comment(request, b, mine.id), await follow(request, b, a.id)]) {
      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'PT403', message: 'You cannot do that.' });
    }
    expect(await ids(request, a, 'likes', `post_id=eq.${mine.id}`, 'user_id')).toEqual([]);
    expect(await ids(request, a, 'comments', `post_id=eq.${mine.id}`)).toEqual([]);
    expect(await ids(request, a, 'follows', `following_id=eq.${a.id}`, 'follower_id')).toEqual([]);
  });

  test('the blocker cannot follow the blocked user either, and a refused action costs no quota', async ({ request }) => {
    const [a, b] = [await createUser(request, 'blocker'), await createUser(request, 'blocked')];
    const mine = await addPost(request, a);
    await block(request, a, b.id);
    const logged = () => Number(runSql(`select count(*) from rate_limit_events where user_id = '${b.id}';`).trim());
    const before = logged();

    expect((await follow(request, a, b.id)).status()).toBe(403);
    expect((await like(request, b, mine.id)).status()).toBe(403);

    expect(logged()).toBe(before);
  });

  test('other people are not affected, and after unblocking everything works again', async ({ request }) => {
    const [a, b, c] = [await createUser(request, 'blocker'), await createUser(request, 'blocked'), await createUser(request, 'third')];
    const mine = await addPost(request, a);
    await block(request, a, b.id);

    expect((await like(request, c, mine.id)).ok()).toBe(true);
    expect((await follow(request, c, a.id)).ok()).toBe(true);
    expect((await like(request, b, mine.id)).status()).toBe(403);

    await unblock(request, a, b.id);
    expect((await like(request, b, mine.id)).ok()).toBe(true);
    expect((await comment(request, b, mine.id)).ok()).toBe(true);
    expect((await follow(request, b, a.id)).ok()).toBe(true);
  });

  test('blocking ends the follows between the two, in both directions, and only those', async ({ request }) => {
    const [a, b, c] = [await createUser(request, 'a'), await createUser(request, 'b'), await createUser(request, 'c')];
    await follow(request, a, b.id);
    await follow(request, b, a.id);
    await follow(request, a, c.id);
    await follow(request, c, b.id);

    await block(request, a, b.id);

    expect(await ids(request, a, 'follows', `follower_id=eq.${a.id}`, 'following_id')).toEqual([c.id]);
    expect(await ids(request, b, 'follows', `follower_id=eq.${b.id}`, 'following_id')).toEqual([]);
    expect(await ids(request, c, 'follows', `follower_id=eq.${c.id}`, 'following_id')).toEqual([b.id]);
  });

  test('a user who blocks does not see the posts of the blocked user: not in the feeds, not by id, not on the profile', async ({ request }) => {
    const [a, b, c] = [await createUser(request, 'blocker'), await createUser(request, 'blocked'), await createUser(request, 'third')];
    const fromB = await addPost(request, b, 'post of the blocked');
    const fromC = await addPost(request, c, 'post of the third');
    await follow(request, a, c.id);
    expect(await ids(request, a, 'posts_feed', `id=in.(${fromB.id},${fromC.id})`)).toHaveLength(2);

    await block(request, a, b.id);

    expect(await ids(request, a, 'posts', `id=in.(${fromB.id},${fromC.id})`)).toEqual([fromC.id]);
    expect(await ids(request, a, 'posts_feed', `id=in.(${fromB.id},${fromC.id})`)).toEqual([fromC.id]);
    expect(await ids(request, a, 'posts_feed', `user_id=eq.${b.id}`)).toEqual([]);
    expect(await ids(request, a, 'posts_following_feed', `id=in.(${fromB.id},${fromC.id})`)).toEqual([fromC.id]);
    // Everybody else sees all of it, the blocked user too
    expect(await ids(request, c, 'posts', `id=in.(${fromB.id},${fromC.id})`)).toHaveLength(2);
    expect(await ids(request, b, 'posts', `id=in.(${fromB.id},${fromC.id})`)).toHaveLength(2);

    await unblock(request, a, b.id);
    expect(await ids(request, a, 'posts_feed', `id=in.(${fromB.id},${fromC.id})`)).toHaveLength(2);
  });

  test('the blocker does not see the comments of the blocked user either, and the counter leaves them out', async ({ request }) => {
    const [a, b, c] = [await createUser(request, 'blocker'), await createUser(request, 'blocked'), await createUser(request, 'third')];
    const target = await addPost(request, c, 'a post to comment on');
    await comment(request, b, target.id, 'from the blocked');
    await comment(request, c, target.id, 'from the author');
    const counter = async (user) => (await (await get(request, user, `posts_feed?id=eq.${target.id}&select=comment_count`)).json())[0].comment_count;
    expect(await counter(a)).toBe(2);

    await block(request, a, b.id);

    const seen = (await (await get(request, a, `comments?post_id=eq.${target.id}&select=content`)).json()).map((row) => row.content);
    expect(seen).toEqual(['from the author']);
    expect(await counter(a)).toBe(1);
    expect(await counter(c)).toBe(2);
  });

  test('the notifications of the blocked user are hidden from the blocker, and come back after unblocking', async ({ request }) => {
    const [a, b] = [await createUser(request, 'blocker'), await createUser(request, 'blocked')];
    const mine = await addPost(request, a);
    await like(request, b, mine.id);
    const actors = async () => ids(request, a, 'notifications', `user_id=eq.${a.id}`, 'actor_id');
    expect(await actors()).toEqual([b.id]);

    await block(request, a, b.id);
    expect(await actors()).toEqual([]);

    await unblock(request, a, b.id);
    expect(await actors()).toEqual([b.id]);
  });

  test('the blocker can still delete and edit their own posts, and the blocked user can still see and change their own', async ({ request }) => {
    const [a, b] = [await createUser(request, 'blocker'), await createUser(request, 'blocked')];
    const mine = await addPost(request, a, 'mine');
    const theirs = await addPost(request, b, 'theirs');
    await block(request, a, b.id);

    const edited = await request.patch(`${API}/rest/v1/posts?id=eq.${mine.id}`, { headers: authHeaders(a, json), data: { content: 'mine, edited' } });
    expect((await edited.json())[0].content).toBe('mine, edited');
    expect(await ids(request, b, 'posts', `id=eq.${theirs.id}`)).toEqual([theirs.id]);
    expect((await del(request, a, `posts?id=eq.${mine.id}`)).ok()).toBe(true);
  });

  test('blocks are removed with the profile of either person', async ({ request }) => {
    const [a, b] = [await createUser(request, 'blocker'), await createUser(request, 'blocked')];
    await block(request, a, b.id);

    runSql(`delete from auth.users where id = '${b.id}';`);

    expect(Number(runSql(`select count(*) from blocks where blocker_id = '${a.id}';`).trim())).toBe(0);
  });

  test('the 21st block within a minute is refused with HTTP 429', async ({ request }) => {
    const me = await createUser(request, 'blocker');
    const targets = bulkUsers(prefixOf(), 21);

    const responses = [];
    for (const id of targets.slice(0, 20)) responses.push(await block(request, me, id));
    expect(countOk(responses)).toBe(20);

    expect((await block(request, me, targets[20])).status()).toBe(429);
  });
});

test.describe('reporting', () => {
  const reports = (where) => runSql(`select reporter_id, reported_user_id, post_id, comment_id, reason, coalesce(details, ''), coalesce(content_snapshot, '') from reports where ${where};`)
    .trim().split('\n').filter(Boolean).map((line) => line.split('|'));

  test('a post can be reported: the database records who wrote it and a copy of the text', async ({ request }) => {
    const [author, reporter] = [await createUser(request, 'author'), await createUser(request, 'reporter')];
    const target = await addPost(request, author, 'something rude');

    const response = await report(request, reporter, { post_id: target.id, reported_user_id: author.id, reason: 'harassment', details: 'it is aimed at me' });

    expect(response.status()).toBe(201);
    expect(reports(`post_id = ${target.id}`)).toEqual([[reporter.id, author.id, String(target.id), '', 'harassment', 'it is aimed at me', 'something rude']]);
  });

  test('the person who is reported cannot be forged: the author of the post is used', async ({ request }) => {
    const [author, reporter, innocent] = [await createUser(request, 'author'), await createUser(request, 'reporter'), await createUser(request, 'innocent')];
    const target = await addPost(request, author, 'a post');

    const response = await report(request, reporter, { post_id: target.id, reported_user_id: innocent.id });

    expect(response.status()).toBe(201);
    expect(reports(`post_id = ${target.id}`)[0][1]).toBe(author.id);
  });

  test('a comment can be reported, and a person can be reported', async ({ request }) => {
    const [author, reporter, third] = [await createUser(request, 'author'), await createUser(request, 'reporter'), await createUser(request, 'third')];
    const target = await addPost(request, third, 'a post');
    const made = await (await post(request, author, 'comments', { post_id: target.id, user_id: author.id, content: 'a nasty comment' }, json)).json();

    expect((await report(request, reporter, { comment_id: made[0].id, reason: 'hate' })).status()).toBe(201);
    expect((await report(request, reporter, { reported_user_id: author.id, reason: 'spam' })).status()).toBe(201);

    expect(reports(`comment_id = ${made[0].id}`)).toEqual([[reporter.id, author.id, '', String(made[0].id), 'hate', '', 'a nasty comment']]);
    expect(reports(`reporter_id = '${reporter.id}' and post_id is null and comment_id is null`)).toEqual([[reporter.id, author.id, '', '', 'spam', '', '']]);
  });

  test('the copy of the text stays when the post is edited, and the report stays when the post is deleted', async ({ request }) => {
    const [author, reporter] = [await createUser(request, 'author'), await createUser(request, 'reporter')];
    const target = await addPost(request, author, 'the first words');
    await report(request, reporter, { post_id: target.id });

    await request.patch(`${API}/rest/v1/posts?id=eq.${target.id}`, { headers: authHeaders(author, json), data: { content: 'harmless now' } });
    await del(request, author, `posts?id=eq.${target.id}`);

    const rows = reports(`reporter_id = '${reporter.id}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe(''); // the post is gone
    expect(rows[0][6]).toBe('the first words');
  });

  test('reporting the same thing twice is refused, but different things are fine', async ({ request }) => {
    const [author, reporter] = [await createUser(request, 'author'), await createUser(request, 'reporter')];
    const first = await addPost(request, author, 'one');
    const second = await addPost(request, author, 'two');

    expect((await report(request, reporter, { post_id: first.id })).status()).toBe(201);
    expect((await report(request, reporter, { post_id: first.id })).status()).toBe(409);
    expect((await report(request, reporter, { post_id: second.id })).status()).toBe(201);
    expect((await report(request, reporter, { reported_user_id: author.id })).status()).toBe(201);
    expect((await report(request, reporter, { reported_user_id: author.id })).status()).toBe(409);
  });

  test('wrong reports are refused: own post, unknown reason, long details, both a post and a comment, a post that does not exist', async ({ request }) => {
    const [author, reporter] = [await createUser(request, 'author'), await createUser(request, 'reporter')];
    const mine = await addPost(request, reporter, 'mine');
    const theirs = await addPost(request, author, 'theirs');
    const made = await (await post(request, author, 'comments', { post_id: theirs.id, user_id: author.id, content: 'c' }, json)).json();

    expect((await report(request, reporter, { post_id: mine.id })).status()).toBe(400);
    expect((await report(request, reporter, { reported_user_id: reporter.id })).status()).toBe(400);
    expect((await report(request, reporter, { post_id: theirs.id, reason: 'because' })).status()).toBe(400);
    expect((await report(request, reporter, { post_id: theirs.id, details: 'x'.repeat(301) })).status()).toBe(400);
    expect((await report(request, reporter, { post_id: theirs.id, comment_id: made[0].id })).status()).toBe(400);
    expect((await report(request, reporter, { post_id: 999999999 })).status()).toBe(400);
    expect((await report(request, reporter, { post_id: theirs.id, details: 'x'.repeat(300) })).status()).toBe(201);
    expect(reports(`reporter_id = '${reporter.id}'`)).toHaveLength(1);
  });

  test('a report is always in the name of the logged-in user and cannot carry a forged copy of the text', async ({ request }) => {
    const [author, reporter, other] = [await createUser(request, 'author'), await createUser(request, 'reporter'), await createUser(request, 'other')];
    const target = await addPost(request, author, 'real words');

    const inOthersName = await post(request, reporter, 'reports', { reporter_id: other.id, post_id: target.id, reason: 'spam' });
    const forgedCopy = await post(request, reporter, 'reports', { reporter_id: reporter.id, post_id: target.id, reason: 'spam', content_snapshot: 'forged' });

    expect(inOthersName.status()).toBe(403);
    expect(forgedCopy.status()).toBe(403);
    expect(reports(`post_id = ${target.id}`)).toEqual([]);
  });

  test('nobody can read, change or delete reports through the API, and visitors cannot send them', async ({ request }) => {
    const [author, reporter] = [await createUser(request, 'author'), await createUser(request, 'reporter')];
    const target = await addPost(request, author, 'a post');
    await report(request, reporter, { post_id: target.id });

    for (const user of [reporter, author]) {
      expect((await get(request, user, 'reports?select=*')).status()).toBe(403);
      expect((await request.patch(`${API}/rest/v1/reports?post_id=eq.${target.id}`, { headers: authHeaders(user, plain), data: { reason: 'other' } })).status()).toBe(403);
      expect((await del(request, user, `reports?post_id=eq.${target.id}`)).status()).toBe(403);
    }
    const visitor = await request.post(`${API}/rest/v1/reports`, { headers: { apikey: KEY, ...plain }, data: { reporter_id: reporter.id, post_id: target.id, reason: 'spam' } });
    expect([401, 403]).toContain(visitor.status());
    expect(reports(`post_id = ${target.id}`)).toHaveLength(1);
  });

  test('the 6th report within a minute is refused with HTTP 429', async ({ request }) => {
    const [author, reporter] = [await createUser(request, 'author'), await createUser(request, 'reporter')];
    const postIds = await bulkPosts(request, author, 6);

    const responses = [];
    for (const id of postIds.slice(0, 5)) responses.push(await report(request, reporter, { post_id: id }));
    expect(countOk(responses)).toBe(5);

    const refused = await report(request, reporter, { post_id: postIds[5] });
    expect(refused.status()).toBe(429);
    expect(await refused.json()).toMatchObject({ code: 'PT429', message: 'You are sending reports too fast. Please wait a minute and try again.' });
  });

  test('a user who is blocked can still be reported by the blocker, and a report is still possible about a hidden post', async ({ request }) => {
    const [a, b] = [await createUser(request, 'blocker'), await createUser(request, 'blocked')];
    const theirs = await addPost(request, b, 'seen before the block');
    await block(request, a, b.id);

    expect((await report(request, a, { post_id: theirs.id })).status()).toBe(201);
    expect((await report(request, a, { reported_user_id: b.id })).status()).toBe(201);
  });
});
