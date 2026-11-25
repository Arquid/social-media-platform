import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { API, createUser, authHeaders, runSql, uploadPostImage, publicPostImageUrl } from './api';
import { newUser, signUp } from './helpers';

// The page of the reports, in a real browser: who can open it, and what an administrator does there.
// (What the database allows: moderation.spec.js.)

const tag = () => randomBytes(3).toString('hex');
const json = { 'Content-Type': 'application/json', Prefer: 'return=representation' };
const plain = { 'Content-Type': 'application/json' };

async function becomeAdmin(page, prefix = 'uiadmin') {
  const admin = newUser(prefix);
  await signUp(page, admin);
  runSql(`insert into admins (user_id) select id from profiles where username = '${admin.username}';`);
  return admin;
}

async function addPost(request, user, content, extra = {}) {
  const response = await request.post(`${API}/rest/v1/posts`, { headers: authHeaders(user, json), data: { user_id: user.id, content, ...extra } });
  expect(response.ok()).toBe(true);
  return (await response.json())[0];
}

async function report(request, reporter, target, reason = 'spam', details = undefined) {
  const response = await request.post(`${API}/rest/v1/reports`, { headers: authHeaders(reporter, plain), data: { reporter_id: reporter.id, reason, details, ...target } });
  expect(response.status()).toBe(201);
}

const card = (page, reporter) => page.locator('.MuiPaper-root', { hasText: `@${reporter.username} reported` });
const state = (sql) => runSql(sql).trim();
const toast = (page, text) => page.getByRole('alert').filter({ hasText: text });

test.describe('who can open the page', () => {
  test('somebody who is not an administrator gets the page of an unknown address', async ({ page }) => {
    await signUp(page, newUser('uiplain'));

    await page.goto('/admin/reports');

    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(0);
  });

  test('a visitor who is not logged in is sent to the login page', async ({ page }) => {
    await page.goto('/admin/reports');

    await expect(page).toHaveURL(/\/login$/);
  });

  test('an administrator sees the reports, the tabs and the number of open reports', async ({ page, request }) => {
    const author = await createUser(request, 'uiauth');
    const reporter = await createUser(request, 'uirep');
    const made = await addPost(request, author, `a reported post ${tag()}`);
    await report(request, reporter, { post_id: made.id }, 'harassment', 'it is aimed at me');
    await becomeAdmin(page);

    await page.goto('/admin/reports');

    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeAttached();
    await expect(page.getByRole('tab', { name: /^Open \(\d+\)$/, selected: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Handled' })).toBeVisible();
    const shown = card(page, reporter);
    await expect(shown).toContainText(`@${reporter.username} reported a post by @${author.username}`);
    await expect(shown).toContainText('Harassment or bullying');
    await expect(shown).toContainText('it is aimed at me');
    await expect(shown).toContainText(made.content);
    await expect(shown.getByRole('link', { name: 'Open the post' })).toHaveAttribute('href', `/post/${made.id}`);
  });
});

test.describe('handling a report', () => {
  test('"Dismiss" with a note: it leaves the open reports and shows up as handled, and the post stays', async ({ page, request }) => {
    const author = await createUser(request, 'uidauth');
    const reporter = await createUser(request, 'uidrep');
    const made = await addPost(request, author, `a harmless post ${tag()}`);
    await report(request, reporter, { post_id: made.id });
    const admin = await becomeAdmin(page);
    await page.goto('/admin/reports');

    await card(page, reporter).getByRole('textbox', { name: 'Note (optional)' }).fill('nothing wrong with it');
    await card(page, reporter).getByRole('button', { name: 'Dismiss' }).click();

    await expect(toast(page, 'Report handled.')).toBeVisible();
    await expect(card(page, reporter)).toHaveCount(0);
    await page.getByRole('tab', { name: 'Handled' }).click();
    await expect(card(page, reporter)).toContainText(`Dismissed by @${admin.username}`);
    await expect(card(page, reporter)).toContainText('nothing wrong with it');
    await expect(card(page, reporter).getByRole('button')).toHaveCount(0);
    expect(state(`select count(*) from posts where id = ${made.id};`)).toBe('1');
  });

  test('"Remove post" asks twice, then deletes the post and its picture, and handles every report about it', async ({ page, request }) => {
    const author = await createUser(request, 'uirauth');
    const first = await createUser(request, 'uirone');
    const second = await createUser(request, 'uirtwo');
    const other = await createUser(request, 'uirother');
    const path = `${author.id}/${Date.now()}.png`;
    expect((await uploadPostImage(request, author, path)).ok()).toBe(true);
    const made = await addPost(request, author, `a post to remove ${tag()}`, { image_path: path });
    const untouched = await addPost(request, author, `another post ${tag()}`);
    await report(request, first, { post_id: made.id });
    await report(request, second, { post_id: made.id });
    await report(request, other, { post_id: untouched.id });
    const admin = await becomeAdmin(page);
    await page.goto('/admin/reports');
    await expect(card(page, first)).toContainText('1 other open report');

    // The first question removes nothing
    await card(page, first).getByRole('button', { name: 'Remove post' }).click();
    await expect(card(page, first).getByRole('button', { name: 'Yes, remove the post' })).toBeVisible();
    expect(state(`select count(*) from posts where id = ${made.id};`)).toBe('1');
    await card(page, first).getByRole('button', { name: 'Cancel' }).click();
    await expect(card(page, first).getByRole('button', { name: 'Remove post' })).toBeVisible();

    await card(page, first).getByRole('textbox', { name: 'Note (optional)' }).fill('against the rules');
    await card(page, first).getByRole('button', { name: 'Remove post' }).click();
    await card(page, first).getByRole('button', { name: 'Yes, remove the post' }).click();

    await expect(toast(page, 'Report handled.')).toBeVisible();
    await expect(card(page, first)).toHaveCount(0);
    await expect(card(page, second)).toHaveCount(0); // handled together
    await expect(card(page, other)).toBeVisible(); // another post: still to do
    expect(state(`select count(*) from posts where id = ${made.id};`)).toBe('0');
    expect(state(`select count(*) from posts where id = ${untouched.id};`)).toBe('1');
    // The file is gone from Storage too
    await expect.poll(async () => (await request.get(publicPostImageUrl(path))).status()).toBe(400);
    // And both reports say what was done
    await page.getByRole('tab', { name: 'Handled' }).click();
    await expect(card(page, first)).toContainText(`Content removed by @${admin.username}`);
    await expect(card(page, second)).toContainText('Content removed');
    await expect(card(page, first)).toContainText('The post has been removed.');
  });

  test('a comment can be removed: the comment goes, the post stays', async ({ page, request }) => {
    const author = await createUser(request, 'uicauth');
    const reporter = await createUser(request, 'uicrep');
    const made = await addPost(request, author, `post with a bad comment ${tag()}`);
    const commented = await request.post(`${API}/rest/v1/comments`, { headers: authHeaders(author, json), data: { post_id: made.id, user_id: author.id, content: 'a bad comment' } });
    const comment = (await commented.json())[0];
    await report(request, reporter, { comment_id: comment.id }, 'hate');
    await becomeAdmin(page);
    await page.goto('/admin/reports');
    await expect(card(page, reporter)).toContainText(`@${reporter.username} reported a comment by @${author.username}`);
    await expect(card(page, reporter)).toContainText('a bad comment');

    await card(page, reporter).getByRole('button', { name: 'Remove comment' }).click();
    await card(page, reporter).getByRole('button', { name: 'Yes, remove the comment' }).click();

    await expect(toast(page, 'Report handled.')).toBeVisible();
    expect(state(`select count(*) from comments where id = ${comment.id};`)).toBe('0');
    expect(state(`select count(*) from posts where id = ${made.id};`)).toBe('1');
  });

  test('a report about a person can be marked as handled, but not removed', async ({ page, request }) => {
    const author = await createUser(request, 'uipauth');
    const reporter = await createUser(request, 'uiprep');
    await report(request, reporter, { reported_user_id: author.id }, 'violence', 'they threatened me');
    await becomeAdmin(page);
    await page.goto('/admin/reports');
    const shown = card(page, reporter);
    await expect(shown).toContainText(`@${reporter.username} reported the person @${author.username}`);
    await expect(shown.getByRole('link', { name: `@${author.username}` })).toHaveAttribute('href', `/profile/${author.username}`);
    await expect(shown.getByRole('button', { name: /^Remove/ })).toHaveCount(0);

    await shown.getByRole('textbox', { name: 'Note (optional)' }).fill('spoke to them');
    await shown.getByRole('button', { name: 'Mark as handled' }).click();

    await expect(toast(page, 'Report handled.')).toBeVisible();
    expect(state(`select resolution, handler_note from reports where reporter_id = '${reporter.id}';`)).toBe('noted|spoke to them');
  });

  test('a report that was handled in the meantime (on another screen) shows the reason, and the list is not changed', async ({ page, request }) => {
    const author = await createUser(request, 'uitwauth');
    const reporter = await createUser(request, 'uitwrep');
    const made = await addPost(request, author, `handled twice ${tag()}`);
    await report(request, reporter, { post_id: made.id });
    await becomeAdmin(page);
    await page.goto('/admin/reports');
    await expect(card(page, reporter)).toBeVisible();
    runSql(`update reports set handled_at = now(), resolution = 'dismissed' where reporter_id = '${reporter.id}';`);

    await card(page, reporter).getByRole('button', { name: 'Dismiss' }).click();

    await expect(toast(page, 'Could not handle the report: This report has already been handled.')).toBeVisible();
    await expect(card(page, reporter)).toBeVisible();
  });
});

test.describe('the page of the reports for the others', () => {
  test('an administrator who loses the right (the row is removed) gets the unknown page again', async ({ page }) => {
    const admin = await becomeAdmin(page);
    await page.goto('/admin/reports');
    await expect(page.getByRole('tab', { name: 'Handled' })).toBeVisible();

    runSql(`delete from admins where user_id = (select id from profiles where username = '${admin.username}');`);
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});
