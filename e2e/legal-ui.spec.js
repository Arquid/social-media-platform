import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { API, createUser, authHeaders, runSql } from './api';
import { newUser, signUp, createPost, postCard, agreement } from './helpers';

// The terms of use, the privacy policy, the agreement at the sign up and "Download my data", in a real browser.
// (The export and the record of the terms in the database: data-export.spec.js.)

const json = { 'Content-Type': 'application/json', Prefer: 'return=representation' };

// "Last updated 26 November 2026" -> "2026-11-26"
function isoOf(text) {
  const [, day, month, year] = text.match(/Last updated (\d+) (\w+) (\d{4})/);
  const index = new Date(`${month} 1, 2000`).getMonth() + 1;
  return `${year}-${String(index).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

test.describe('the texts', () => {
  test('are open to everybody, with one heading, the date and sections', async ({ page }) => {
    for (const [path, title] of [['/terms', 'Terms of Use'], ['/privacy', 'Privacy Policy']]) {
      await page.goto(path);

      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByText(/^Last updated \d+ \w+ \d{4}$/)).toBeVisible();
      expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThanOrEqual(6);
      await expect(page).toHaveURL(path); // a visitor is not sent to the login page
    }
  });

  test('the footer leads to them from every page, also when logged in and on the 404 page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Terms of Use' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of Use' })).toBeVisible();

    await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy Policy' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();

    await page.goto('/no-such-page');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Privacy Policy' })).toBeVisible();

    await signUp(page, newUser('footer'));
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Terms of Use' })).toBeVisible();
  });

  test('refer to each other, and say what is true: the buttons they name are on the profile page', async ({ page }) => {
    await page.goto('/privacy');
    await page.getByRole('main').getByRole('link', { name: 'Terms of Use' }).click();
    await expect(page).toHaveURL('/terms');
    await page.getByRole('main').getByRole('link', { name: 'Privacy Policy' }).first().click();
    await expect(page).toHaveURL('/privacy');

    const user = newUser('named');
    await signUp(page, user);
    await page.goto(`/profile/${user.username}`);
    await expect(page.getByRole('button', { name: 'Download my data' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete account' })).toBeVisible();
  });
});

test.describe('the agreement at the sign up', () => {
  test('is a box that is not ticked, and without it nothing is sent', async ({ page }) => {
    let signUpRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/auth/v1/signup')) signUpRequests += 1;
    });
    const user = newUser('noagree');
    await page.goto('/register');
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);

    await expect(agreement(page)).not.toBeChecked();
    await page.getByRole('button', { name: 'Sign up' }).click();

    await expect(page).toHaveURL(/\/register$/);
    expect(await agreement(page).evaluate((box) => box.validity.valueMissing)).toBe(true);
    expect(signUpRequests).toBe(0);
    expect(runSql(`select count(*) from profiles where username = '${user.username}';`).trim()).toBe('0');
  });

  test('its links open the texts in a new tab, and the form keeps what was typed', async ({ page, context }) => {
    await page.goto('/register');
    await page.getByLabel('Username').fill('still_here');

    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('main').getByRole('link', { name: 'Terms of Use' }).click(),
    ]);

    await popup.waitForLoadState();
    await expect(popup).toHaveURL(/\/terms$/);
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByLabel('Username')).toHaveValue('still_here');
    await popup.close();
  });

  test('once it is ticked the sign up works, and the version of the texts is written down', async ({ page }) => {
    const user = newUser('agreed');
    await signUp(page, user);

    // The version in the database is the date of the texts that the visitor saw
    await page.goto('/terms');
    const shown = isoOf(await page.getByText(/^Last updated /).textContent());
    expect(runSql(`select c.version from consents c join profiles p on p.id = c.user_id where p.username = '${user.username}';`).trim()).toBe(shown);
  });
});

test.describe('Download my data', () => {
  async function download(page) {
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download my data' }).click(),
    ]);
    return file;
  }

  test('saves a file with everything: the account, the posts, the comments, the likes, the follows and the version of the texts', async ({ page, request }) => {
    const me = newUser('export');
    await signUp(page, me);
    const text = `my post ${Math.random().toString(36).slice(2, 7)}`;
    await createPost(page, text);
    const friend = await createUser(request, 'expfriend');
    const friendText = `a post of a friend ${Math.random().toString(36).slice(2, 7)}`;
    const made = await request.post(`${API}/rest/v1/posts`, { headers: authHeaders(friend, json), data: { user_id: friend.id, content: friendText } });
    const theirs = (await made.json())[0];
    await page.goto('/');
    const card = postCard(page, friendText);
    await card.getByRole('button', { name: 'Like post' }).click();
    await expect(card.getByRole('button', { name: 'Unlike post' })).toBeVisible();
    await card.getByRole('button', { name: 'Show comments' }).click();
    await card.getByLabel('Write a comment').fill('my comment');
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(card.getByText('my comment')).toBeVisible();
    await page.goto(`/profile/${friend.username}`);
    await page.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unfollow' })).toBeVisible();
    await page.goto(`/profile/${me.username}`);

    const file = await download(page);

    expect(file.suggestedFilename()).toMatch(new RegExp(`^socialy-data-${me.username}-\\d{4}-\\d{2}-\\d{2}\\.json$`));
    const data = JSON.parse(readFileSync(await file.path(), 'utf8'));
    expect(data.account).toMatchObject({ username: me.username, email: me.email });
    expect(data.posts.map((p) => p.content)).toEqual([text]);
    expect(data.comments).toEqual([expect.objectContaining({ post_id: theirs.id, content: 'my comment' })]);
    expect(data.likes).toEqual([expect.objectContaining({ post_id: theirs.id })]);
    expect(data.following.map((f) => f.username)).toEqual([friend.username]);
    expect(data.accepted_terms).toHaveLength(1);
    expect(data.accepted_terms[0].version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Nobody else's data, and nothing about the other people that is not public anyway
    expect(JSON.stringify(data)).not.toContain(friend.id);
    expect(JSON.stringify(data)).not.toContain(`${friend.username}@example.test`);
    await expect(page.getByText('Your data was downloaded.')).toBeVisible();
    // it is readable: indented, not one long line
    expect(readFileSync(await file.path(), 'utf8')).toContain('\n  "account"');
  });

  test('is on your own profile only', async ({ page, request }) => {
    await signUp(page, newUser('ownonly'));
    const other = await createUser(request, 'notmine');

    await page.goto(`/profile/${other.username}`);

    await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download my data' })).toHaveCount(0);
  });

  test('five times an hour: the sixth says so, in red, and saves nothing', async ({ page }) => {
    const me = newUser('limit');
    await signUp(page, me);
    await page.goto(`/profile/${me.username}`);
    for (let i = 0; i < 5; i += 1) await download(page);

    let sixth = false;
    page.once('download', () => { sixth = true; });
    await page.getByRole('button', { name: 'Download my data' }).click();

    await expect(page.getByText('Could not download your data: You can download your data 5 times an hour. Please try again later.')).toBeVisible();
    await page.waitForTimeout(500);
    expect(sixth).toBe(false);
    await expect(page.getByRole('button', { name: 'Download my data' })).toBeEnabled();
  });
});
