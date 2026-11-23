import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { createUser, createProfilesInBulk, runSql, waitForRealtimeToCatchUp } from './api';
import { newUser, signUp, createPost, postCard } from './helpers';

// Infinite scroll in a real browser: the next page comes by itself when the "Load more" button comes
// near the screen, and not before. The lists are longer than a page, and written straight into the
// database (triggers and rate limits are switched off for that, so 45 rows take a moment).
//
// The screen is only 400 pixels high, so the button of a first page is far away at first.

test.use({ viewport: { width: 1280, height: 400 } });

const tag = () => randomBytes(3).toString('hex');
const idOf = (user) => runSql(`select id from profiles where username = '${user.username}';`).trim();
const scrollToTheEnd = (page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
const texts = (locator) => locator.allTextContents();
const nothingMoreHappens = (page) => page.waitForTimeout(1500);

function writePosts(authorId, label, count) {
  runSql(`
    set session_replication_role = replica;
    insert into posts (user_id, content) select '${authorId}', '${label} ' || g from generate_series(1, ${count}) g;
  `);
}

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

const makePostForNotifications = (authorId) => Number(runSql(`
  set session_replication_role = replica;
  insert into posts (user_id, content) values ('${authorId}', 'post for scrolling') returning id;
`).split('\n').map((line) => line.trim()).find((line) => /^\d+$/.test(line)));

test.describe('the feed', () => {
  test('loads a page when the end comes near, one page at a time, and not before', async ({ page, request }) => {
    const author = await createUser(request, 'scrollauth');
    const label = `sp${tag()}`;
    writePosts(author.id, label, 45);
    await signUp(page, newUser('scroller'));
    await waitForRealtimeToCatchUp();
    const pageRequests = [];
    page.on('request', (r) => {
      if (r.url().includes('/rest/v1/posts_feed') && r.url().includes('id=lt.')) pageRequests.push(r.url());
    });

    await page.goto(`/profile/${author.username}`);
    const cards = postCard(page, label);
    await expect(cards).toHaveCount(20);
    await nothingMoreHappens(page); // the end is far away: nothing is loaded
    await expect(cards).toHaveCount(20);
    expect(pageRequests).toHaveLength(0);
    await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();

    await scrollToTheEnd(page); // no click
    await expect(cards).toHaveCount(40);
    await nothingMoreHappens(page); // the new posts pushed the end away again
    await expect(cards).toHaveCount(40);
    expect(pageRequests).toHaveLength(1);

    await scrollToTheEnd(page);
    await expect(cards).toHaveCount(45);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
    await nothingMoreHappens(page);
    expect(pageRequests).toHaveLength(2); // each page was asked for once

    // The newest first, and nobody twice
    const posted = (await texts(page.getByText(new RegExp(`^${label} \\d+$`)))).map((text) => Number(text.split(' ')[1]));
    expect(posted[0]).toBe(45);
    expect(posted.at(-1)).toBe(1);
    expect(new Set(posted).size).toBe(45);
  });

  test('a screen that is tall enough is filled without any scrolling', async ({ page, request }) => {
    const author = await createUser(request, 'tallauth');
    const label = `tp${tag()}`;
    writePosts(author.id, label, 45);
    await signUp(page, newUser('tall'));
    await waitForRealtimeToCatchUp();
    await page.setViewportSize({ width: 1280, height: 12000 });

    await page.goto(`/profile/${author.username}`);

    await expect(postCard(page, label)).toHaveCount(45);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  });

  test('the Load more button is still there, and works too', async ({ page, request }) => {
    const author = await createUser(request, 'btnauth');
    const label = `bp${tag()}`;
    writePosts(author.id, label, 25);
    await signUp(page, newUser('presser'));
    await waitForRealtimeToCatchUp();

    await page.goto(`/profile/${author.username}`);
    await expect(postCard(page, label)).toHaveCount(20);
    await page.getByRole('button', { name: 'Load more' }).focus();
    await page.keyboard.press('Enter');

    await expect(postCard(page, label)).toHaveCount(25);
  });

  test('a broken connection stops the loading: one message, and the button tries again', async ({ page, request }) => {
    const author = await createUser(request, 'errauth');
    const label = `ep${tag()}`;
    writePosts(author.id, label, 45);
    await signUp(page, newUser('unlucky'));
    await waitForRealtimeToCatchUp();
    let asked = 0;
    await page.route('**/rest/v1/posts_feed*id=lt.*', (route) => {
      asked += 1;
      return route.abort();
    });

    await page.goto(`/profile/${author.username}`);
    const cards = postCard(page, label);
    await expect(cards).toHaveCount(20);
    await scrollToTheEnd(page);

    // The client tries a failed request a few times before it gives up: that is still one load
    await expect(page.getByText(/Could not load more posts/)).toBeVisible({ timeout: 30_000 });
    const triesOfTheFirstLoad = asked;
    expect(triesOfTheFirstLoad).toBeGreaterThanOrEqual(1);
    await nothingMoreHappens(page); // the button is still near the screen, but nothing is asked again
    expect(asked).toBe(triesOfTheFirstLoad);
    await expect(cards).toHaveCount(20);

    await page.unroute('**/rest/v1/posts_feed*id=lt.*');
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(cards).toHaveCount(40);
    // The scrolling works again after the click: the next page comes when the end is near
    await scrollToTheEnd(page);
    await expect(cards).toHaveCount(45);
  });
});

test.describe('notifications', () => {
  test('come by themselves while scrolling, 20 at a time, each person once', async ({ page, request }) => {
    const user = newUser('scrnot');
    await signUp(page, user);
    const author = await createUser(request, 'snauth');
    const postId = makePostForNotifications(author.id);
    const prefix = `sn${tag()}`;
    writeNotifications(idOf(user), postId, prefix, 45);

    await page.goto('/notifications');
    const rows = page.getByRole('list').getByRole('link');
    await expect(rows).toHaveCount(20);
    await nothingMoreHappens(page);
    await expect(rows).toHaveCount(20);

    await scrollToTheEnd(page);
    await expect(rows).toHaveCount(40);
    await scrollToTheEnd(page);
    await expect(rows).toHaveCount(45);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

    const actors = (await texts(rows)).map((text) => text.split(' ')[0]);
    expect(actors[0]).toBe(`@${prefix}_45`);
    expect(new Set(actors).size).toBe(45);
  });

  test('a broken connection stops the loading until the button is pressed', async ({ page, request }) => {
    const user = newUser('scrnoterr');
    await signUp(page, user);
    const author = await createUser(request, 'sneauth');
    const postId = makePostForNotifications(author.id);
    writeNotifications(idOf(user), postId, `se${tag()}`, 30);
    let asked = 0;
    await page.route('**/rest/v1/notifications*id=lt.*', (route) => {
      asked += 1;
      return route.abort();
    });

    await page.goto('/notifications');
    const rows = page.getByRole('list').getByRole('link');
    await expect(rows).toHaveCount(20);
    await scrollToTheEnd(page);
    await expect(page.getByText(/Could not load more notifications/)).toBeVisible({ timeout: 30_000 });
    const triesOfTheFirstLoad = asked;
    expect(triesOfTheFirstLoad).toBeGreaterThanOrEqual(1);
    await nothingMoreHappens(page);
    expect(asked).toBe(triesOfTheFirstLoad);

    await page.unroute('**/rest/v1/notifications*id=lt.*');
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(rows).toHaveCount(30);
  });
});

test.describe('comments', () => {
  test('under a post come by themselves while scrolling', async ({ page }) => {
    await signUp(page, newUser('scrcom'));
    const text = `scroll comments ${tag()}`;
    await createPost(page, text);
    const postId = Number(runSql(`select id from posts where content = '${text}';`).trim());
    const label = `sc${tag()}`;
    writeComments(postId, `pc${tag()}`, label, 45);

    await page.goto(`/post/${postId}`);
    const comments = page.getByText(new RegExp(`${label} \\d+$`));
    await expect(comments).toHaveCount(20);
    await nothingMoreHappens(page);
    await expect(comments).toHaveCount(20);

    await scrollToTheEnd(page);
    await expect(comments).toHaveCount(40);
    await scrollToTheEnd(page);
    await expect(comments).toHaveCount(45);
    await expect(page.getByRole('button', { name: 'Load more comments' })).toHaveCount(0);
    expect((await texts(comments))[0]).toContain(`${label} 45`);
    expect((await texts(comments)).at(-1)).toContain(`${label} 1`);
  });
});

test.describe('search', () => {
  test('shows the next people by itself while scrolling, and a new search starts from the top', async ({ page }) => {
    await signUp(page, newUser('scrsearch'));
    const prefix = `ss${tag()}`;
    createProfilesInBulk(prefix, 45);

    await page.goto(`/search?q=${prefix}`);
    const people = page.getByRole('list', { name: 'Search results' }).getByRole('listitem');
    await expect(people).toHaveCount(20);
    await nothingMoreHappens(page);
    await expect(people).toHaveCount(20);

    await scrollToTheEnd(page);
    await expect(people).toHaveCount(40);
    await scrollToTheEnd(page);
    await expect(people).toHaveCount(45);
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
    const names = (await texts(people)).map((text) => text.match(new RegExp(`${prefix}_\\d+`))[0]);
    expect(new Set(names).size).toBe(45);

    // A new text starts again with one page
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('searchbox', { name: 'Search users' }).fill(`${prefix}_`);
    await expect(people).toHaveCount(20);
  });
});
