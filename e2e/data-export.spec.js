import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { API, KEY, createUser, authHeaders, runSql } from './api';

// "Download my data" and the record of the accepted terms, straight against the database.
// (The button and the pages: legal-ui.spec.js.)

const json = { 'Content-Type': 'application/json', Prefer: 'return=representation' };
const plain = { 'Content-Type': 'application/json' };

const insert = (request, user, table, data) => request.post(`${API}/rest/v1/${table}`, { headers: authHeaders(user, json), data });
const exportData = (request, user) => request.post(`${API}/rest/v1/rpc/export_my_data`, { headers: authHeaders(user, plain), data: {} });
const mine = async (request, user) => (await exportData(request, user)).json();
// Nobody can read the reports back, so no representation is asked for
const report = async (request, reporter, data) => {
  const response = await request.post(`${API}/rest/v1/reports`, { headers: authHeaders(reporter, plain), data: { reporter_id: reporter.id, ...data } });
  expect(response.status()).toBe(201);
};

// A sign up like the one of the form: the version of the terms goes in the user metadata
async function signUpWith(request, metadata) {
  const username = `exp_${randomBytes(4).toString('hex')}`;
  const response = await request.post(`${API}/auth/v1/signup`, {
    headers: { apikey: KEY, 'X-Supabase-Api-Version': '2024-01-01' },
    data: { email: `${username}@example.test`, password: `Pw-${randomBytes(8).toString('hex')}`, data: { username, ...metadata } },
  });
  const body = await response.json();
  return { username, id: body.user.id, token: body.access_token };
}

test.describe('who can ask', () => {
  test('a visitor who is not logged in is refused', async ({ request }) => {
    const response = await request.post(`${API}/rest/v1/rpc/export_my_data`, { headers: { apikey: KEY, ...plain }, data: {} });

    expect([401, 403]).toContain(response.status());
  });

  test('everybody gets their own data, and nobody can ask for the data of somebody else', async ({ request }) => {
    const [ann, bob] = [await createUser(request, 'expann'), await createUser(request, 'expbob')];

    const [forAnn, forBob] = [await mine(request, ann), await mine(request, bob)];

    expect(forAnn.account.id).toBe(ann.id);
    expect(forBob.account.id).toBe(bob.id);
    // The function takes no argument: there is no way to name another person
    const named = await request.post(`${API}/rest/v1/rpc/export_my_data`, { headers: authHeaders(ann, plain), data: { user_id: bob.id } });
    expect(named.ok()).toBe(false);
  });
});

test.describe('what is in it', () => {
  test('the account, with the email, and empty lists for a new account (never null)', async ({ request }) => {
    const user = await createUser(request, 'expnew');

    const data = await mine(request, user);

    expect(data.account).toMatchObject({ id: user.id, username: user.username, email: `${user.username}@example.test` });
    expect(data.account.created_at).toBeTruthy();
    expect(Date.parse(data.exported_at)).not.toBeNaN();
    for (const list of ['accepted_terms', 'posts', 'comments', 'likes', 'following', 'followers', 'blocked_users', 'notifications', 'reports_sent']) {
      expect(data[list], list).toEqual([]);
    }
    expect(data.notes.join(' ')).toContain('Reports that other people made about you are not included');
  });

  test('everything the person has made, in order, and what happened to them', async ({ request }) => {
    const [me, friend, fan] = [await createUser(request, 'expme'), await createUser(request, 'expfriend'), await createUser(request, 'expfan')];
    await request.patch(`${API}/rest/v1/profiles?id=eq.${me.id}`, { headers: authHeaders(me, json), data: { display_name: 'Me Myself', bio: 'my bio' } });
    const first = (await (await insert(request, me, 'posts', { user_id: me.id, content: 'first post' })).json())[0];
    const second = (await (await insert(request, me, 'posts', { user_id: me.id, content: 'second post', image_path: `${me.id}/1.png` })).json())[0];
    const theirs = (await (await insert(request, friend, 'posts', { user_id: friend.id, content: 'a post of a friend' })).json())[0];
    await insert(request, me, 'comments', { post_id: theirs.id, user_id: me.id, content: 'my comment' });
    await insert(request, me, 'likes', { post_id: theirs.id, user_id: me.id });
    await insert(request, me, 'follows', { follower_id: me.id, following_id: friend.id });
    await insert(request, fan, 'follows', { follower_id: fan.id, following_id: me.id });
    await insert(request, fan, 'likes', { post_id: first.id, user_id: fan.id }); // a notification for me
    await insert(request, me, 'blocks', { blocker_id: me.id, blocked_id: fan.id });
    await report(request, me, { post_id: theirs.id, reason: 'spam', details: 'it is spam' });

    const data = await mine(request, me);

    expect(data.account).toMatchObject({ display_name: 'Me Myself', bio: 'my bio' });
    expect(data.posts.map((p) => [p.id, p.content, p.image_path])).toEqual([[first.id, 'first post', null], [second.id, 'second post', `${me.id}/1.png`]]);
    expect(data.comments).toEqual([expect.objectContaining({ post_id: theirs.id, content: 'my comment' })]);
    expect(data.likes).toEqual([expect.objectContaining({ post_id: theirs.id })]);
    expect(data.following.map((f) => f.username)).toEqual([friend.username]);
    // The follow of the fan was ended when I blocked them: they are not a follower any more
    expect(data.followers).toEqual([]);
    expect(data.blocked_users.map((b) => b.username)).toEqual([fan.username]);
    // the fan followed me, then liked my post (the notifications stay when the follow is ended)
    expect(data.notifications.map((n) => [n.type, n.from_username])).toEqual([['follow', fan.username], ['like', fan.username]]);
    expect(data.notifications[1]).toMatchObject({ post_id: first.id, read: false });
    expect(data.reports_sent).toEqual([expect.objectContaining({ reason: 'spam', details: 'it is spam', about_username: friend.username, post_id: theirs.id })]);
  });

  test('followers are listed (and the people who follow stay people, not ids)', async ({ request }) => {
    const [me, fan] = [await createUser(request, 'expme2'), await createUser(request, 'expfan2')];
    await insert(request, fan, 'follows', { follower_id: fan.id, following_id: me.id });

    const data = await mine(request, me);

    expect(data.followers.map((f) => f.username)).toEqual([fan.username]);
    expect(JSON.stringify(data)).not.toContain(fan.id);
  });

  test('nothing of other people: not their posts, comments, likes, email, blocks, or the reports about me', async ({ request }) => {
    const [me, other, reporter] = [await createUser(request, 'expmine'), await createUser(request, 'expother'), await createUser(request, 'expreporter')];
    const mineP = (await (await insert(request, me, 'posts', { user_id: me.id, content: 'mine' })).json())[0];
    const otherP = (await (await insert(request, other, 'posts', { user_id: other.id, content: 'secret words of other' })).json())[0];
    await insert(request, other, 'comments', { post_id: mineP.id, user_id: other.id, content: 'a comment of another person' });
    await insert(request, other, 'likes', { post_id: otherP.id, user_id: other.id });
    await insert(request, other, 'blocks', { blocker_id: other.id, blocked_id: me.id });
    await report(request, reporter, { post_id: mineP.id, reason: 'harassment', details: 'a secret detail of the reporter' });

    const text = JSON.stringify(await mine(request, me));

    for (const secret of ['secret words of other', 'a comment of another person', `${other.username}@example.test`, 'a secret detail of the reporter', other.id, reporter.id, reporter.username]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain('mine');
    // somebody blocked me: I do not learn about it from the export either
    expect(JSON.parse(text).blocked_users).toEqual([]);
  });

  test('a person with many posts gets them all', async ({ request }) => {
    const user = await createUser(request, 'expmany');
    runSql(`
      set session_replication_role = replica;
      insert into posts (user_id, content) select '${user.id}', 'bulk ' || g from generate_series(1, 400) g;
    `);

    const data = await mine(request, user);

    expect(data.posts).toHaveLength(400);
    expect(data.posts[0].content).toBe('bulk 1');
    expect(data.posts.at(-1).content).toBe('bulk 400');
  });
});

test.describe('the limit', () => {
  test('5 downloads an hour: the 6th is refused with 429, and the limit is per person', async ({ request }) => {
    const [user, other] = [await createUser(request, 'explimit'), await createUser(request, 'expfree')];
    for (let i = 0; i < 5; i += 1) expect((await exportData(request, user)).status()).toBe(200);

    const refused = await exportData(request, user);

    expect(refused.status()).toBe(429);
    expect(await refused.json()).toMatchObject({ code: 'PT429', message: 'You can download your data 5 times an hour. Please try again later.' });
    expect((await exportData(request, other)).status()).toBe(200);
  });

  test('a refused download is not counted again, and after an hour the person can download again', async ({ request }) => {
    const user = await createUser(request, 'expagain');
    for (let i = 0; i < 5; i += 1) await exportData(request, user);
    await exportData(request, user);
    expect(runSql(`select count(*) from rate_limit_events where user_id = '${user.id}' and kind = 'export';`).trim()).toBe('5');

    runSql(`update rate_limit_events set created_at = created_at - interval '2 hours' where user_id = '${user.id}' and kind = 'export';`);

    expect((await exportData(request, user)).status()).toBe(200);
  });

  test('the downloads do not use up the quota of posts, comments or likes', async ({ request }) => {
    const user = await createUser(request, 'expquota');
    for (let i = 0; i < 5; i += 1) await exportData(request, user);

    const post = await insert(request, user, 'posts', { user_id: user.id, content: 'still can post' });

    expect(post.status()).toBe(201);
  });
});

test.describe('the record of the accepted terms', () => {
  test('a sign up that sends the version of the terms is written down, and comes back in the export', async ({ request }) => {
    await signUpWith(request, { accepted_legal_version: '2025-01-01' }); // somebody else, who accepted an older version
    const user = await signUpWith(request, { accepted_legal_version: '2026-11-26' });

    expect(runSql(`select version from consents where user_id = '${user.id}';`).trim()).toBe('2026-11-26');
    const data = await mine(request, user);
    expect(data.accepted_terms).toEqual([expect.objectContaining({ version: '2026-11-26' })]); // not the one of the other person
    expect(data.accepted_terms[0].accepted_at).toBeTruthy();
  });

  test('a sign up without a version (or with an empty one) still works and writes nothing', async ({ request }) => {
    const none = await signUpWith(request, {});
    const empty = await signUpWith(request, { accepted_legal_version: '   ' });

    for (const user of [none, empty]) {
      expect(runSql(`select count(*) from profiles where id = '${user.id}';`).trim()).toBe('1');
      expect(runSql(`select count(*) from consents where user_id = '${user.id}';`).trim()).toBe('0');
    }
  });

  test('a very long version is cut, and the table cannot be read or written through the API', async ({ request }) => {
    const user = await signUpWith(request, { accepted_legal_version: 'x'.repeat(500) });
    expect(runSql(`select length(version) from consents where user_id = '${user.id}';`).trim()).toBe('40');

    expect((await request.get(`${API}/rest/v1/consents?select=*`, { headers: authHeaders(user) })).status()).toBe(403);
    expect((await insert(request, user, 'consents', { user_id: user.id, version: 'forged' })).status()).toBe(403);
    expect((await request.delete(`${API}/rest/v1/consents?user_id=eq.${user.id}`, { headers: authHeaders(user) })).status()).toBe(403);
  });

  test('the record goes with the account', async ({ request }) => {
    const user = await signUpWith(request, { accepted_legal_version: '2026-11-26' });

    runSql(`delete from auth.users where id = '${user.id}';`);

    expect(runSql(`select count(*) from consents where user_id = '${user.id}';`).trim()).toBe('0');
  });
});
