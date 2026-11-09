import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { createUser, createProfilesInBulk, runSql, API, authHeaders } from './api';
import { newUser, signUp, createPost, postCard, listenToFrames, waitForSubscription } from './helpers';

// Notifications, comments and search results come 20 at a time. These tests make lists that are
// longer than a page and click through them in a real browser.
//
// The rows are written straight into the database (triggers and the rate limit are switched off
// for that, so 50 rows take a moment) and the people involved are made in bulk.

const tag = () => randomBytes(3).toString('hex');
const json = { 'Content-Type': 'application/json', Prefer: 'return=minimal' };

const idOf = (user) => runSql(`select id from profiles where username = '${user.username}';`).trim();

// Writes `count` comments on a post, one by each of the people `<prefix>_1` ... `<prefix>_<count>`.
// Comment "<label> 1" is the oldest, "<label> <count>" the newest.
function writeComments(postId, prefix, label, count) {
  createProfilesInBulk(prefix, count);
  runSql(`
    set session_replication_role = replica;
    insert into comments (post_id, user_id, content)
      select ${postId}, p.id, '${label} ' || n
      from (select id, substring(username from '[0-9]+$')::int as n from profiles where username like '${prefix}\\_%') p
      order by n;
  `);
}

// Writes one notification for `userId` from each of the people `<prefix>_1` ... `<prefix>_<count>`,
// in that order: the last person is the newest notification
function writeNotifications(userId, postId, prefix, count) {
  createProfilesInBulk(prefix, count);
  runSql(`
    set session_replication_role = replica;
    insert into notifications (user_id, actor_id, type, post_id)
      select '${userId}', p.id, 'comment', ${postId}
      from (select id, substring(username from '[0-9]+$')::int as n from profiles where username like '${prefix}\\_%') p
      order by n;
  `);
}

const texts = (locator) => locator.allTextContents();

test.describe('notifications', () => {
  test('come 20 at a time, newest first, and new ones go on top', async ({ page, request }) => {
    const frames = listenToFrames(page);
    const user = newUser('pgnot');
    await signUp(page, user);
    const userId = idOf(user);
    const author = await createUser(request, 'pgnauth');
    const postId = Number(runSql(`
      set session_replication_role = replica;
      insert into posts (user_id, content) values ('${author.id}', 'post for notifications') returning id;
    `).split('\n').map((line) => line.trim()).find((line) => /^\d+$/.test(line)));
    const prefix = `pn${tag()}`;
    writeNotifications(userId, postId, prefix, 45);

    await page.goto('/notifications');
    const rows = page.getByRole('list').getByRole('link');
    await expect(rows).toHaveCount(20);
    // The newest first: person 45, then 44 ...
    expect((await texts(rows))[0]).toContain(`@${prefix}_45 commented`);
    expect((await texts(rows))[19]).toContain(`@${prefix}_26 commented`);

    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(rows).toHaveCount(40);
    expect((await texts(rows))[39]).toContain(`@${prefix}_6 commented`);

    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(rows).toHaveCount(45);
    expect((await texts(rows))[44]).toContain(`@${prefix}_1 commented`);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

    // Everybody exactly once
    const actors = (await texts(rows)).map((text) => text.split(' ')[0]);
    expect(new Set(actors).size).toBe(45);

    // A new notification arrives while the page is open: it goes to the top
    await waitForSubscription(page, frames, 'notifications-page');
    const newcomer = await createUser(request, 'pgnnew');
    runSql(`insert into notifications (user_id, actor_id, type, post_id) values ('${userId}', '${newcomer.id}', 'comment', ${postId});`);
    await expect(rows).toHaveCount(46);
    expect((await texts(rows))[0]).toContain(`@${newcomer.username} commented`);
    expect((await texts(rows))[1]).toContain(`@${prefix}_45 commented`);
  });

  test('a short list has no "Load more" button', async ({ page, request }) => {
    const user = newUser('pgnshort');
    await signUp(page, user);
    const author = await createUser(request, 'pgsauth');
    const postId = Number(runSql(`
      set session_replication_role = replica;
      insert into posts (user_id, content) values ('${author.id}', 'short list post') returning id;
    `).split('\n').map((line) => line.trim()).find((line) => /^\d+$/.test(line)));
    writeNotifications(idOf(user), postId, `ps${tag()}`, 19);

    await page.goto('/notifications');

    await expect(page.getByRole('list').getByRole('link')).toHaveCount(19);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  });
});

test.describe('comments', () => {
  test('come 20 at a time, newest first, and a new comment goes on top', async ({ page, request }) => {
    const frames = listenToFrames(page);
    const user = newUser('pgcom');
    await signUp(page, user);
    const text = `pagination post ${tag()}`;
    await createPost(page, text);
    const postId = Number(runSql(`select id from posts where content = '${text}';`).trim());
    const label = `cm${tag()}`;
    writeComments(postId, `pc${tag()}`, label, 45);

    await page.goto(`/post/${postId}`);
    const comments = page.getByText(new RegExp(`${label} \\d+$`));
    await expect(comments).toHaveCount(20);
    expect((await texts(comments))[0]).toContain(`${label} 45`);
    expect((await texts(comments))[19]).toContain(`${label} 26`);

    // The box for writing is above the list, so a new comment appears right below it
    const box = page.getByRole('textbox', { name: 'Write a comment' });
    const boxTop = (await box.boundingBox()).y;
    expect((await comments.first().boundingBox()).y).toBeGreaterThan(boxTop);

    await page.getByRole('button', { name: 'Load more comments' }).click();
    await expect(comments).toHaveCount(40);
    await page.getByRole('button', { name: 'Load more comments' }).click();
    await expect(comments).toHaveCount(45);
    expect((await texts(comments))[44]).toContain(`${label} 1`);
    await expect(page.getByRole('button', { name: 'Load more comments' })).toHaveCount(0);

    // Your own comment goes to the top at once
    await box.fill('my own comment');
    await page.getByRole('button', { name: 'Send' }).click();
    const mine = page.getByText('my own comment');
    await expect(mine).toBeVisible();
    expect((await mine.boundingBox()).y).toBeLessThan((await comments.first().boundingBox()).y);

    // Somebody else's comment arrives in real time and goes to the top as well
    await waitForSubscription(page, frames, 'comments-');
    const other = await createUser(request, 'pgcother');
    await request.post(`${API}/rest/v1/comments`, {
      headers: authHeaders(other, json),
      data: { post_id: postId, user_id: other.id, content: 'from somebody else' },
    });
    const theirs = page.getByText('from somebody else');
    await expect(theirs).toBeVisible();
    expect((await theirs.boundingBox()).y).toBeLessThan((await mine.boundingBox()).y);
  });

  test('a post with a few comments shows them all and no button', async ({ page }) => {
    const user = newUser('pgfew');
    await signUp(page, user);
    const text = `few comments ${tag()}`;
    await createPost(page, text);
    const postId = Number(runSql(`select id from posts where content = '${text}';`).trim());
    const label = `fw${tag()}`;
    writeComments(postId, `pf${tag()}`, label, 3);

    await page.goto(`/post/${postId}`);

    await expect(page.getByText(new RegExp(`${label} \\d+$`))).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Load more comments' })).toHaveCount(0);
  });

  test('can be opened under a post in the feed too, with the same pages', async ({ page }) => {
    const user = newUser('pgfeed');
    await signUp(page, user);
    const text = `feed comments ${tag()}`;
    await createPost(page, text);
    const postId = Number(runSql(`select id from posts where content = '${text}';`).trim());
    const label = `fd${tag()}`;
    writeComments(postId, `pd${tag()}`, label, 25);

    await page.goto('/');
    await postCard(page, text).getByRole('button', { name: 'Show comments' }).click();

    const comments = page.getByText(new RegExp(`${label} \\d+$`));
    await expect(comments).toHaveCount(20);
    await page.getByRole('button', { name: 'Load more comments' }).click();
    await expect(comments).toHaveCount(25);
  });
});

test.describe('search', () => {
  test('shows 20 people, then 20 more, then the rest, and then no button', async ({ page }) => {
    await signUp(page, newUser('pgsearch'));
    const prefix = `sr${tag()}`;
    createProfilesInBulk(prefix, 45);

    await page.goto(`/search?q=${prefix}`);
    const people = page.getByRole('list', { name: 'Search results' }).getByRole('listitem');
    await expect(people).toHaveCount(20);

    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(people).toHaveCount(40);

    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(people).toHaveCount(45);
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);

    // 45 different people, none twice
    const names = (await texts(people)).map((text) => text.match(new RegExp(`${prefix}_\\d+`))[0]);
    expect(new Set(names).size).toBe(45);
  });

  test('starts again from the first page when the text changes', async ({ page }) => {
    await signUp(page, newUser('pgagain'));
    const prefix = `sa${tag()}`;
    createProfilesInBulk(prefix, 45);

    await page.goto(`/search?q=${prefix}`);
    const people = page.getByRole('list', { name: 'Search results' }).getByRole('listitem');
    await expect(people).toHaveCount(20);
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(people).toHaveCount(40);

    // A narrower text: only "_4", "_40" ... "_45" contain it, seven people in all
    await page.getByRole('searchbox', { name: 'Search users' }).fill(`${prefix}_4`);

    await expect(people).toHaveCount(7);
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
  });

  test('a few matches have no "Show more" button', async ({ page }) => {
    await signUp(page, newUser('pgfew2'));
    const prefix = `sf${tag()}`;
    createProfilesInBulk(prefix, 3);

    await page.goto(`/search?q=${prefix}`);

    await expect(page.getByRole('list', { name: 'Search results' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
  });
});
