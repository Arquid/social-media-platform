import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { newUser, signUp } from './helpers';
import { createUserNamed, patchProfile } from './api';

const tag = () => randomBytes(3).toString('hex');

const searchBox = (page) => page.getByRole('searchbox', { name: 'Search users' });
const results = (page) => page.getByRole('list', { name: 'Search results' });

// A person who can be found: an exact username, a display name and a bio
async function findablePerson(request, { username, displayName, bio = '' }) {
  const user = await createUserNamed(request, username);
  await patchProfile(request, user, { display_name: displayName, bio });
  return user;
}

// Counts the searches the page sends to the database
function countSearches(page) {
  const counter = { count: 0 };
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/rpc/search_profiles')) counter.count += 1;
  });
  return counter;
}

test.describe('user search', () => {
  test('the search button in the navbar opens the page, ready for typing', async ({ page }) => {
    await signUp(page, newUser('seeker'));

    await page.getByRole('link', { name: 'Search users' }).click();

    await expect(page).toHaveURL('/search');
    await expect(searchBox(page)).toBeFocused();
    await expect(page.getByText(/type at least 2 characters/i)).toBeVisible();
  });

  test('finds a person by username and opens their profile', async ({ page, request }) => {
    const t = tag();
    await findablePerson(request, { username: `fnd_${t}`, displayName: `Findable ${t}`, bio: 'Likes testing' });
    await signUp(page, newUser('seeker'));
    await page.goto('/search');

    await searchBox(page).fill(`fnd_${t}`);

    const row = results(page).getByRole('link', { name: new RegExp(`Findable ${t}`) });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`@fnd_${t} · Likes testing`);

    await row.click();
    await expect(page).toHaveURL(`/profile/fnd_${t}`);
    await expect(page.getByRole('heading', { name: `Findable ${t}` })).toBeVisible();
  });

  test('finds a person by display name, in any letter case, and by part of a word', async ({ page, request }) => {
    const t = tag();
    await findablePerson(request, { username: `quiet_${t}`, displayName: `Zeppelin Captain ${t}` });
    await signUp(page, newUser('seeker'));
    await page.goto('/search');

    await searchBox(page).fill(`ZEPPELIN captain ${t.toUpperCase()}`);
    await expect(results(page).getByRole('link')).toHaveCount(1);

    await searchBox(page).fill(`ppelin Cap`);
    await expect(results(page).getByRole('link', { name: new RegExp(`Zeppelin Captain ${t}`) })).toBeVisible();
  });

  test('sends one search after fast typing, not one per letter', async ({ page, request }) => {
    const t = tag();
    await findablePerson(request, { username: `fast_${t}`, displayName: `Fast Typist ${t}` });
    await signUp(page, newUser('seeker'));
    await page.goto('/search');
    const searches = countSearches(page);

    await searchBox(page).pressSequentially(`fast_${t}`, { delay: 40 });

    await expect(results(page).getByRole('link', { name: new RegExp(`Fast Typist ${t}`) })).toBeVisible();
    expect(searches.count).toBe(1);
  });

  test('one letter does not start a search', async ({ page }) => {
    await signUp(page, newUser('seeker'));
    await page.goto('/search');
    const searches = countSearches(page);

    await searchBox(page).fill('a');
    await page.waitForTimeout(800); // longer than the typing delay

    expect(searches.count).toBe(0);
    await expect(page.getByText(/type at least 2 characters/i)).toBeVisible();
  });

  test('says so when nobody is found', async ({ page }) => {
    await signUp(page, newUser('seeker'));
    await page.goto('/search');

    await searchBox(page).fill(`nobody-called-${tag()}`);

    await expect(page.getByText(/No users found for "nobody-called-/)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the text is in the address, survives a reload and comes back after visiting a profile', async ({ page, request }) => {
    const t = tag();
    await findablePerson(request, { username: `keep_${t}`, displayName: `Keeper ${t}` });
    await signUp(page, newUser('seeker'));
    await page.goto('/search');

    await searchBox(page).fill(`keep_${t}`);
    await expect(page).toHaveURL(`/search?q=keep_${t}`);
    await expect(results(page).getByRole('link', { name: new RegExp(`Keeper ${t}`) })).toBeVisible();

    // Reload: the box and the results are restored from the address
    await page.reload();
    await expect(searchBox(page)).toHaveValue(`keep_${t}`);
    await expect(results(page).getByRole('link', { name: new RegExp(`Keeper ${t}`) })).toBeVisible();

    // Visit the profile and come back with the back button: one step, not one per letter
    await results(page).getByRole('link', { name: new RegExp(`Keeper ${t}`) }).click();
    await expect(page).toHaveURL(`/profile/keep_${t}`);
    await page.goBack();
    await expect(page).toHaveURL(`/search?q=keep_${t}`);
    await expect(searchBox(page)).toHaveValue(`keep_${t}`);
    await expect(results(page).getByRole('link', { name: new RegExp(`Keeper ${t}`) })).toBeVisible();

    // A shared link works for someone else too
    await page.goto(`/search?q=keep_${t}`);
    await expect(results(page).getByRole('link', { name: new RegExp(`Keeper ${t}`) })).toBeVisible();
  });

  test('emptying the box removes the text from the address and the results', async ({ page, request }) => {
    const t = tag();
    await findablePerson(request, { username: `clr_${t}`, displayName: `Clearable ${t}` });
    await signUp(page, newUser('seeker'));
    await page.goto('/search');
    await searchBox(page).fill(`clr_${t}`);
    await expect(results(page)).toBeVisible();

    await searchBox(page).fill('');

    await expect(page).toHaveURL('/search');
    await expect(results(page)).toHaveCount(0);
    await expect(page.getByText(/type at least 2 characters/i)).toBeVisible();
  });

  test('special characters are searched as plain text', async ({ page, request }) => {
    const t = tag();
    await findablePerson(request, { username: `pct_${t}`, displayName: `Fifty%Off ${t}` });
    await findablePerson(request, { username: `plain_${t}`, displayName: `FiftyXOff ${t}` });
    await signUp(page, newUser('seeker'));
    await page.goto('/search');

    // "%Off <tag>" must not behave as a wildcard and also find "FiftyXOff <tag>"
    await searchBox(page).fill(`%Off ${t}`);
    await expect(results(page).getByRole('link')).toHaveCount(1);
    await expect(results(page).getByRole('link', { name: new RegExp(`Fifty%Off ${t}`) })).toBeVisible();

    // Text that looks like code or breaks filters just finds nobody
    for (const text of [`x'); drop table profiles; --`, 'a,b)', '"quoted"', '\\\\']) {
      await searchBox(page).fill(text);
      await expect(page.getByText(/No users found for/)).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
  });
});

test.describe('search needs a login', () => {
  test('a visitor is sent to the login page', async ({ page }) => {
    await page.goto('/search?q=anna');

    await expect(page).toHaveURL(/\/login$/);
  });

  test('the navbar of a visitor has no search button', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('link', { name: 'Search users' })).toHaveCount(0);
  });
});
