import { test, expect } from '@playwright/test';
import { API, KEY, TINY_PNG, createUser, authHeaders, runSql, uploadPostImage, publicPostImageUrl } from './api';

// Handling the reports, straight against the database: who may use the functions of the administrator,
// the list, and what each way of handling a report does. (The page: moderation-ui.spec.js.)

const json = { 'Content-Type': 'application/json', Prefer: 'return=representation' };
const plain = { 'Content-Type': 'application/json' };

const post = (request, user, path, data, headers = plain) =>
  request.post(`${API}/rest/v1/${path}`, { headers: authHeaders(user, headers), data });
const rpc = (request, user, name, data = {}) => post(request, user, `rpc/${name}`, data);
const list = async (request, admin, args = {}) => (await rpc(request, admin, 'admin_list_reports', args)).json();
const resolve = (request, admin, id, resolution, note) =>
  rpc(request, admin, 'admin_resolve_report', { p_report_id: id, p_resolution: resolution, p_note: note });

async function makeAdmin(request, prefix = 'modadmin') {
  const user = await createUser(request, prefix);
  runSql(`insert into admins (user_id) select id from profiles where username = '${user.username}';`);
  return user;
}

async function addPost(request, user, content = 'a post') {
  const response = await post(request, user, 'posts', { user_id: user.id, content }, json);
  expect(response.ok()).toBe(true);
  return (await response.json())[0];
}

async function addComment(request, user, postId, content = 'a comment') {
  const response = await post(request, user, 'comments', { post_id: postId, user_id: user.id, content }, json);
  expect(response.ok()).toBe(true);
  return (await response.json())[0];
}

// A report in the name of `reporter`. It is made with a new reporter by default, because of the limit of five a minute.
async function report(request, reporter, target, reason = 'spam', details = undefined) {
  const response = await post(request, reporter, 'reports', { reporter_id: reporter.id, reason, details, ...target });
  expect(response.status()).toBe(201);
}

// The id of the newest report of `reporterId` (the id that the functions work with)
const reportIdOf = (reporter) =>
  Number(runSql(`select max(id) from reports where reporter_id = '${reporter.id}';`).trim());

// A post, a comment under it and a report of each kind, by three different people
async function scene(request) {
  const author = await createUser(request, 'modauth');
  const target = await addPost(request, author, `a post that is reported ${Math.random().toString(36).slice(2, 6)}`);
  return { author, target };
}

test.describe('who may use the functions of the administrator', () => {
  test('a visitor who is not logged in is refused', async ({ request }) => {
    for (const name of ['is_admin', 'admin_list_reports', 'admin_open_report_count']) {
      const response = await request.post(`${API}/rest/v1/rpc/${name}`, { headers: { apikey: KEY, ...plain }, data: {} });
      expect([401, 403], name).toContain(response.status());
    }
    const resolved = await request.post(`${API}/rest/v1/rpc/admin_resolve_report`, {
      headers: { apikey: KEY, ...plain }, data: { p_report_id: 1, p_resolution: 'dismissed' },
    });
    expect([401, 403]).toContain(resolved.status());
  });

  test('a user who is not an administrator is told so, and is refused by every function', async ({ request }) => {
    const user = await createUser(request, 'modplain');

    expect(await (await rpc(request, user, 'is_admin')).json()).toBe(false);
    for (const response of [
      await rpc(request, user, 'admin_list_reports'),
      await rpc(request, user, 'admin_open_report_count'),
      await resolve(request, user, 1, 'dismissed'),
    ]) {
      expect(response.status()).toBe(403);
      expect((await response.json()).code).toBe('42501');
    }
  });

  test('an administrator is told so, and somebody else is not', async ({ request }) => {
    const admin = await makeAdmin(request);
    const other = await createUser(request, 'modother');

    expect(await (await rpc(request, admin, 'is_admin')).json()).toBe(true);
    expect(await (await rpc(request, other, 'is_admin')).json()).toBe(false);
  });

  test('nobody can read or change the list of administrators through the API, not even an administrator', async ({ request }) => {
    const admin = await makeAdmin(request);
    const user = await createUser(request, 'modwannabe');

    for (const who of [admin, user]) {
      expect((await request.get(`${API}/rest/v1/admins?select=*`, { headers: authHeaders(who) })).status()).toBe(403);
      expect((await post(request, who, 'admins', { user_id: user.id })).status()).toBe(403);
      expect((await request.delete(`${API}/rest/v1/admins?user_id=eq.${admin.id}`, { headers: authHeaders(who) })).status()).toBe(403);
    }
    expect(await (await rpc(request, user, 'is_admin')).json()).toBe(false);
    expect(runSql(`select count(*) from admins where user_id = '${admin.id}';`).trim()).toBe('1');
  });

  test('a user cannot hand in a report that is already handled, or handle one themselves', async ({ request }) => {
    const { target } = await scene(request);
    const reporter = await createUser(request, 'modforger');

    const forged = await post(request, reporter, 'reports', { reporter_id: reporter.id, post_id: target.id, reason: 'spam', handled_at: new Date().toISOString(), resolution: 'dismissed' });
    expect(forged.status()).toBe(403);

    await report(request, reporter, { post_id: target.id });
    const patched = await request.patch(`${API}/rest/v1/reports?reporter_id=eq.${reporter.id}`, { headers: authHeaders(reporter, plain), data: { resolution: 'dismissed' } });
    expect(patched.status()).toBe(403);
    expect(runSql(`select handled_at is null from reports where reporter_id = '${reporter.id}';`).trim()).toBe('t');
  });

  test('a report is handled exactly when it has a resolution (the database insists)', () => {
    const attempt = (set) => runSql(`
      \\set ON_ERROR_STOP on
      begin;
      insert into reports (reporter_id, reported_user_id, reason) select a.id, b.id, 'spam' from profiles a, profiles b where a.id <> b.id limit 1;
      update reports set ${set} where id = (select max(id) from reports);
      rollback;
    `);

    expect(() => attempt('handled_at = now()')).toThrow();
    expect(() => attempt("resolution = 'dismissed'")).toThrow();
    expect(() => attempt("handled_at = now(), resolution = 'nonsense'")).toThrow();
    expect(() => attempt(`handled_at = now(), resolution = 'noted', handler_note = '${'x'.repeat(301)}'`)).toThrow();
  });
});

test.describe('the list of reports', () => {
  test('shows who reported whom, why, the copy of the text and the state, newest first', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { author, target } = await scene(request);
    const comment = await addComment(request, author, target.id, 'a comment that is reported');
    const [r1, r2, r3] = [await createUser(request, 'modrep'), await createUser(request, 'modrep'), await createUser(request, 'modrep')];
    await report(request, r1, { post_id: target.id }, 'harassment', 'it hurts');
    await report(request, r2, { comment_id: comment.id }, 'spam');
    await report(request, r3, { reported_user_id: author.id }, 'hate');

    const rows = await list(request, admin, { p_limit: 3 });

    expect(rows.map((r) => r.reporter_username)).toEqual([r3.username, r2.username, r1.username]);
    expect(rows[2]).toMatchObject({
      reason: 'harassment', details: 'it hurts', content_snapshot: target.content, reported_username: author.username,
      reported_user_id: author.id, post_id: target.id, comment_id: null, content_exists: true, other_reports: 0,
      handled_at: null, handled_by_username: null, resolution: null, handler_note: null,
    });
    expect(rows[1]).toMatchObject({ comment_id: comment.id, post_id: null, content_snapshot: 'a comment that is reported', content_exists: true });
    expect(rows[0]).toMatchObject({ post_id: null, comment_id: null, content_exists: null, content_snapshot: null, reported_user_id: author.id });
  });

  test('counts the other open reports about the same thing, and keeps different things apart', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { author, target } = await scene(request);
    const other = await addPost(request, author, 'another post');
    const people = [await createUser(request, 'modcount'), await createUser(request, 'modcount'), await createUser(request, 'modcount')];
    await report(request, people[0], { post_id: target.id });
    await report(request, people[1], { post_id: target.id });
    await report(request, people[2], { post_id: other.id });
    await report(request, people[0], { reported_user_id: author.id });

    const rows = await list(request, admin, { p_limit: 4 });
    const of = (post) => rows.filter((r) => r.post_id === post.id).map((r) => r.other_reports);

    expect(of(target)).toEqual([1, 1]);
    expect(of(other)).toEqual([0]);
    expect(rows.find((r) => r.post_id === null).other_reports).toBe(0); // a report about the person is a thing of its own
  });

  test('does not count the reports about the same thing that were handled already', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { author, target } = await scene(request);
    const [first, second] = [await createUser(request, 'modold'), await createUser(request, 'modnew')];
    await report(request, first, { post_id: target.id });
    await report(request, second, { post_id: target.id });
    runSql(`update reports set handled_at = now(), resolution = 'dismissed' where reporter_id = '${first.id}';`);

    const open = await list(request, admin, { p_before: reportIdOf(second) + 1, p_limit: 1 });

    expect(open[0]).toMatchObject({ reporter_username: second.username, other_reports: 0 });
    expect(author.id).toBeTruthy();
  });

  test('has pages: the id of the last one is the start of the next, nothing twice, and the size is limited', async ({ request }) => {
    const admin = await makeAdmin(request);
    const offender = await createUser(request, 'modpages');
    const reporter = await createUser(request, 'modpgrep');
    runSql(`
      set session_replication_role = replica;
      insert into posts (user_id, content) select '${offender.id}', 'bulk ' || g from generate_series(1, 45) g;
      insert into reports (reporter_id, reported_user_id, post_id, reason, content_snapshot)
        select '${reporter.id}', '${offender.id}', id, 'spam', content from posts where user_id = '${offender.id}';
    `);

    const first = await list(request, admin, { p_limit: 20 });
    const second = await list(request, admin, { p_limit: 20, p_before: first.at(-1).id });

    expect(first).toHaveLength(20);
    expect(second).toHaveLength(20);
    const ids = [...first, ...second].map((r) => r.id);
    expect(new Set(ids).size).toBe(40);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
    expect((await list(request, admin, { p_limit: 1000 })).length).toBeLessThanOrEqual(50);
    expect(await list(request, admin, { p_limit: 0 })).toHaveLength(1);
  });

  test('has the open ones and the handled ones apart, and an unknown status is refused', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { target } = await scene(request);
    const reporter = await createUser(request, 'modapart');
    await report(request, reporter, { post_id: target.id });
    const id = reportIdOf(reporter);

    expect((await list(request, admin, { p_before: id + 1, p_limit: 1 }))[0].id).toBe(id);
    expect((await list(request, admin, { p_status: 'handled', p_before: id + 1, p_limit: 1 })).map((r) => r.id)).not.toContain(id);
    await resolve(request, admin, id, 'dismissed', 'fine');

    expect((await list(request, admin, { p_status: 'open', p_before: id + 1, p_limit: 50 })).map((r) => r.id)).not.toContain(id);
    const handled = (await list(request, admin, { p_status: 'handled', p_before: id + 1, p_limit: 1 }))[0];
    expect(handled).toMatchObject({ id, resolution: 'dismissed', handler_note: 'fine', handled_by_username: admin.username });
    expect(handled.handled_at).toBeTruthy();

    const refused = await rpc(request, admin, 'admin_list_reports', { p_status: 'everything' });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).code).toBe('PT400');
  });

  test('counts the open reports', async ({ request }) => {
    const admin = await makeAdmin(request);
    const count = async () => (await (await rpc(request, admin, 'admin_open_report_count')).json());
    const before = await count();
    const { target } = await scene(request);
    const reporter = await createUser(request, 'modcounter');

    await report(request, reporter, { post_id: target.id });
    expect(await count()).toBe(before + 1);

    await resolve(request, admin, reportIdOf(reporter), 'dismissed');
    expect(await count()).toBe(before);
  });
});

test.describe('handling a report', () => {
  test('"dismissed" marks it handled, with who, when and a note, and leaves the post alone', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { author, target } = await scene(request);
    const reporter = await createUser(request, 'moddis');
    await report(request, reporter, { post_id: target.id });
    const id = reportIdOf(reporter);

    const response = await resolve(request, admin, id, 'dismissed', '  looks fine to me  ');

    expect(response.status()).toBe(200);
    expect(await response.json()).toBeNull();
    expect(runSql(`select resolution, handler_note, handled_by = '${admin.id}', handled_at is not null from reports where id = ${id};`).trim())
      .toBe('dismissed|looks fine to me|t|t');
    const stillThere = await request.get(`${API}/rest/v1/posts?id=eq.${target.id}&select=id`, { headers: authHeaders(author) });
    expect(await stillThere.json()).toHaveLength(1);
  });

  test('a note that is only spaces is no note', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { target } = await scene(request);
    const reporter = await createUser(request, 'modnonote');
    await report(request, reporter, { post_id: target.id });
    const id = reportIdOf(reporter);

    await resolve(request, admin, id, 'dismissed', '   ');

    expect(runSql(`select handler_note is null from reports where id = ${id};`).trim()).toBe('t');
  });

  test('"content_removed" deletes the post with its comments and likes, and the report stays with its copy of the text', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { author, target } = await scene(request);
    const fan = await createUser(request, 'modfan');
    await addComment(request, fan, target.id);
    await post(request, fan, 'likes', { post_id: target.id, user_id: fan.id });
    const reporter = await createUser(request, 'modrem');
    await report(request, reporter, { post_id: target.id });
    const id = reportIdOf(reporter);

    const response = await resolve(request, admin, id, 'content_removed', 'removed');

    expect(response.status()).toBe(200);
    expect(await response.json()).toBeNull(); // no picture
    expect(runSql(`select count(*) from posts where id = ${target.id};`).trim()).toBe('0');
    expect(runSql(`select count(*) from comments where post_id = ${target.id};`).trim()).toBe('0');
    expect(runSql(`select count(*) from likes where post_id = ${target.id};`).trim()).toBe('0');
    const kept = runSql(`select resolution, content_snapshot, post_id from reports where id = ${id};`).trim().split('|');
    expect(kept).toEqual(['content_removed', target.content, String(target.id)]);
    const [listed] = await list(request, admin, { p_status: 'handled', p_before: id + 1, p_limit: 1 });
    expect(listed).toMatchObject({ content_exists: false, reported_username: author.username });
  });

  test('gives back the picture of a removed post, so that the page can remove the file too', async ({ request }) => {
    const admin = await makeAdmin(request);
    const author = await createUser(request, 'modpic');
    const path = `${author.id}/${Date.now()}.png`;
    expect((await uploadPostImage(request, author, path)).ok()).toBe(true);
    const made = await post(request, author, 'posts', { user_id: author.id, content: 'a post with a picture', image_path: path }, json);
    const target = (await made.json())[0];
    const reporter = await createUser(request, 'modpicrep');
    await report(request, reporter, { post_id: target.id });

    const response = await resolve(request, admin, reportIdOf(reporter), 'content_removed');

    expect(await response.json()).toBe(path);
    // The administrator may remove the file; a post that is not removed keeps its file in the way of everybody else
    expect((await request.get(publicPostImageUrl(path))).status()).toBe(200);
    const removed = await request.delete(`${API}/storage/v1/object/post-images/${path}`, { headers: authHeaders(admin) });
    expect(removed.ok()).toBe(true);
    expect((await request.get(publicPostImageUrl(path))).status()).toBe(400);
  });

  test('somebody who is not an administrator still cannot remove the file of another user', async ({ request }) => {
    const author = await createUser(request, 'modown');
    const other = await createUser(request, 'modnot');
    const path = `${author.id}/${Date.now()}.png`;
    await uploadPostImage(request, author, path, { body: TINY_PNG });

    await request.delete(`${API}/storage/v1/object/post-images/${path}`, { headers: authHeaders(other) });

    expect((await request.get(publicPostImageUrl(path))).status()).toBe(200);
  });

  test('"content_removed" on a comment deletes the comment only', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { author, target } = await scene(request);
    const comment = await addComment(request, author, target.id, 'a bad comment');
    const reporter = await createUser(request, 'modcom');
    await report(request, reporter, { comment_id: comment.id });

    await resolve(request, admin, reportIdOf(reporter), 'content_removed');

    expect(runSql(`select count(*) from comments where id = ${comment.id};`).trim()).toBe('0');
    expect(runSql(`select count(*) from posts where id = ${target.id};`).trim()).toBe('1');
  });

  test('a person cannot be "removed": only a post or a comment, and nothing changes', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { author } = await scene(request);
    const reporter = await createUser(request, 'modperson');
    await report(request, reporter, { reported_user_id: author.id });
    const id = reportIdOf(reporter);

    const response = await resolve(request, admin, id, 'content_removed');

    expect(response.status()).toBe(400);
    expect((await response.json()).message).toContain('Only a post or a comment');
    expect(runSql(`select handled_at is null from reports where id = ${id};`).trim()).toBe('t');
  });

  test('"noted" is for what was done outside the app, with a note about it', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { author } = await scene(request);
    const reporter = await createUser(request, 'modnoted');
    await report(request, reporter, { reported_user_id: author.id }, 'harassment');
    const id = reportIdOf(reporter);

    await resolve(request, admin, id, 'noted', 'spoke to them by email');

    expect(runSql(`select resolution, handler_note from reports where id = ${id};`).trim()).toBe('noted|spoke to them by email');
  });

  test('handles every open report about the same thing together, and no other', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { author, target } = await scene(request);
    const other = await addPost(request, author, 'a different post');
    const people = [await createUser(request, 'modgrp'), await createUser(request, 'modgrp'), await createUser(request, 'modgrp'), await createUser(request, 'modgrp')];
    await report(request, people[0], { post_id: target.id });
    await report(request, people[1], { post_id: target.id });
    await report(request, people[2], { post_id: other.id });
    await report(request, people[3], { reported_user_id: author.id });
    // an older report about the same post that was handled before: it must keep its own handling
    runSql(`
      insert into reports (reporter_id, reported_user_id, post_id, reason, handled_at, resolution, handler_note)
      values ('${people[3].id}', '${author.id}', ${target.id}, 'other', now() - interval '1 day', 'dismissed', 'earlier');
    `);
    const first = reportIdOf(people[0]);

    await resolve(request, admin, first, 'content_removed', 'both gone');

    const state = (person) => runSql(`select resolution, handler_note from reports where reporter_id = '${person.id}' and post_id is ${person === people[3] ? 'null' : 'not null'} order by id;`).trim();
    expect(state(people[0])).toBe('content_removed|both gone');
    expect(state(people[1])).toBe('content_removed|both gone');
    expect(state(people[2])).toBe('|'); // the other post
    expect(state(people[3])).toBe('|'); // the person
    expect(runSql(`select handler_note from reports where post_id = ${target.id} and handler_note = 'earlier';`).trim()).toBe('earlier');
  });

  test('a report cannot be handled twice, a report that is not there is a 404, and bad input is a 400: nothing changes', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { target } = await scene(request);
    const reporter = await createUser(request, 'moderr');
    await report(request, reporter, { post_id: target.id });
    const id = reportIdOf(reporter);

    const bad = await resolve(request, admin, id, 'banished');
    expect(bad.status()).toBe(400);
    const long = await resolve(request, admin, id, 'noted', 'x'.repeat(301));
    expect(long.status()).toBe(400);
    expect(runSql(`select handled_at is null from reports where id = ${id};`).trim()).toBe('t');

    expect((await resolve(request, admin, id, 'dismissed')).status()).toBe(200);
    const again = await resolve(request, admin, id, 'content_removed');
    expect(again.status()).toBe(409);
    expect((await again.json()).message).toBe('This report has already been handled.');
    expect(runSql(`select count(*) from posts where id = ${target.id};`).trim()).toBe('1'); // not removed after all

    const missing = await resolve(request, admin, 999999999, 'dismissed');
    expect(missing.status()).toBe(404);
  });

  test('a user who is not an administrator changes nothing', async ({ request }) => {
    const { author, target } = await scene(request);
    const reporter = await createUser(request, 'modsneak');
    await report(request, reporter, { post_id: target.id });
    const id = reportIdOf(reporter);

    const response = await resolve(request, author, id, 'content_removed');

    expect(response.status()).toBe(403);
    expect(runSql(`select handled_at is null from reports where id = ${id};`).trim()).toBe('t');
    expect(runSql(`select count(*) from posts where id = ${target.id};`).trim()).toBe('1');
  });
});

test.describe('the reports and the accounts', () => {
  test('a post can be deleted by its author even if the same user also reported the author (it used to fail)', async ({ request }) => {
    const { author, target } = await scene(request);
    const reporter = await createUser(request, 'modboth');
    await report(request, reporter, { post_id: target.id });
    await report(request, reporter, { reported_user_id: author.id });

    const removed = await request.delete(`${API}/rest/v1/posts?id=eq.${target.id}`, { headers: authHeaders(author) });

    expect(removed.ok()).toBe(true);
    expect(runSql(`select count(*) from reports where reporter_id = '${reporter.id}';`).trim()).toBe('2');
  });

  test('a report keeps the number of the deleted post and does not turn into a report about the person', async ({ request }) => {
    const { author, target } = await scene(request);
    const reporter = await createUser(request, 'modkeep');
    await report(request, reporter, { post_id: target.id });
    await request.delete(`${API}/rest/v1/posts?id=eq.${target.id}`, { headers: authHeaders(author) });

    expect(runSql(`select post_id from reports where reporter_id = '${reporter.id}';`).trim()).toBe(String(target.id));
  });

  test('an administrator who deletes their account loses the rights, and what they handled stays handled', async ({ request }) => {
    const admin = await makeAdmin(request);
    const { target } = await scene(request);
    const reporter = await createUser(request, 'modgone');
    await report(request, reporter, { post_id: target.id });
    const id = reportIdOf(reporter);
    await resolve(request, admin, id, 'dismissed', 'ok');

    runSql(`delete from auth.users where id = '${admin.id}';`);

    expect(runSql(`select count(*) from admins where user_id = '${admin.id}';`).trim()).toBe('0');
    expect(runSql(`select resolution, handled_by is null from reports where id = ${id};`).trim()).toBe('dismissed|t');
  });
});
