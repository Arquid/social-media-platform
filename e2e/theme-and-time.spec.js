import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { newUser, signUp, createPost, postCard, bell } from './helpers';
import { API, authHeaders, createUserNamed } from './api';

// The colors of the two themes (see src/theme.js), as the browser reports them
const LIGHT_PAGE = 'rgb(244, 245, 250)';
const DARK_PAGE = 'rgb(18, 20, 28)';
const DARK_CARD = 'rgb(27, 30, 42)';

const backgroundOf = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const toLight = (page) => page.getByRole('button', { name: 'Switch to light theme' });
const toDark = (page) => page.getByRole('button', { name: 'Switch to dark theme' });

// WCAG contrast ratio of an element's text against the background that is really behind it.
// Normal text needs at least 4.5.
async function contrastOf(locator) {
  return locator.evaluate((element) => {
    const parse = (value) => value.match(/[\d.]+/g).map(Number);
    const luminance = ([r, g, b]) => {
      const channel = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    // Walk up until a background that is not transparent is found
    let node = element;
    let background = [255, 255, 255];
    while (node) {
      const [r, g, b, a = 1] = parse(getComputedStyle(node).backgroundColor);
      if (a > 0) {
        background = [r, g, b];
        break;
      }
      node = node.parentElement;
    }

    // Text such as the gray secondary text is slightly transparent: mix it with the background
    const [r, g, b, a = 1] = parse(getComputedStyle(element).color);
    const text = [r, g, b].map((channel, i) => channel * a + background[i] * (1 - a));
    const lighter = Math.max(luminance(text), luminance(background));
    const darker = Math.min(luminance(text), luminance(background));
    return (lighter + 0.05) / (darker + 0.05);
  });
}

test.describe('theme on a dark device', () => {
  test.use({ colorScheme: 'dark' });

  test('starts dark and offers the light theme', async ({ page }) => {
    await page.goto('/login');

    await expect(toLight(page)).toBeVisible();
    expect(await backgroundOf(page)).toBe(DARK_PAGE);
  });

  test('the toggle switches the theme, and the choice survives a reload and a new tab', async ({ page, context }) => {
    await page.goto('/login');

    await toLight(page).click();
    await expect(toDark(page)).toBeVisible();
    expect(await backgroundOf(page)).toBe(LIGHT_PAGE);

    await page.reload();
    await expect(toDark(page)).toBeVisible(); // still light, although the device is dark
    expect(await backgroundOf(page)).toBe(LIGHT_PAGE);

    const other = await context.newPage();
    await other.goto('/login');
    await expect(toDark(other)).toBeVisible();
    expect(await backgroundOf(other)).toBe(LIGHT_PAGE);
  });

  test('the choice belongs to the browser: a new visitor gets the device setting again', async ({ page, browser }) => {
    await page.goto('/login');
    await toLight(page).click();
    await expect(toDark(page)).toBeVisible();

    const fresh = await browser.newContext({ colorScheme: 'dark' });
    const freshPage = await fresh.newPage();
    await freshPage.goto('/login');

    await expect(toLight(freshPage)).toBeVisible();
    expect(await backgroundOf(freshPage)).toBe(DARK_PAGE);
    await fresh.close();
  });
});

test.describe('theme on a light device', () => {
  test.use({ colorScheme: 'light' });

  test('starts light and can be switched to dark and back', async ({ page }) => {
    await page.goto('/login');
    await expect(toDark(page)).toBeVisible();
    expect(await backgroundOf(page)).toBe(LIGHT_PAGE);

    await toDark(page).click();
    await expect(toLight(page)).toBeVisible();
    expect(await backgroundOf(page)).toBe(DARK_PAGE);

    await page.reload();
    expect(await backgroundOf(page)).toBe(DARK_PAGE);

    await toLight(page).click();
    await expect(toDark(page)).toBeVisible();
    expect(await backgroundOf(page)).toBe(LIGHT_PAGE);
  });
});

test.describe('the app in both themes', () => {
  for (const scheme of ['light', 'dark']) {
    test.describe(`${scheme} theme`, () => {
      test.use({ colorScheme: scheme });

      test('the toggle is there after logging in, and cards and text are readable', async ({ page }) => {
        const user = newUser('look');
        await signUp(page, user);
        const text = `Readable ${user.username}`;
        await createPost(page, text);

        await expect(scheme === 'dark' ? toLight(page) : toDark(page)).toBeVisible();
        expect(await backgroundOf(page)).toBe(scheme === 'dark' ? DARK_PAGE : LIGHT_PAGE);

        const card = postCard(page, text);
        const cardBackground = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
        if (scheme === 'dark') expect(cardBackground).toBe(DARK_CARD);

        // Normal text on a card, the author's name (a link), the time (small gray text)
        // and the app name in the navigation bar must all be easy to read
        expect(await contrastOf(card.getByText(text, { exact: true }))).toBeGreaterThanOrEqual(4.5);
        expect(await contrastOf(card.getByRole('link', { name: `@${user.username}` }))).toBeGreaterThanOrEqual(4.5);
        expect(await contrastOf(card.locator('time'))).toBeGreaterThanOrEqual(4.5);
        expect(await contrastOf(page.getByRole('link', { name: 'Socialy' }))).toBeGreaterThanOrEqual(4.5);

        // The Post button is only checked when it is in use (disabled buttons are exempt)
        await page.getByPlaceholder("What's on your mind?").fill('x');
        const postButton = page.getByRole('button', { name: 'Post', exact: true });
        await expect(postButton).toBeEnabled();
        expect(await contrastOf(postButton)).toBeGreaterThanOrEqual(4.5);
      });

      test('the choice made on the login page is still there after signing up', async ({ page }) => {
        await page.goto('/login');
        await (scheme === 'dark' ? toLight(page) : toDark(page)).click();
        const chosen = scheme === 'dark' ? LIGHT_PAGE : DARK_PAGE;

        await signUp(page, newUser('keep'));

        expect(await backgroundOf(page)).toBe(chosen);
      });
    });
  }
});

test.describe('time of posts and notifications', () => {
  const tag = () => randomBytes(3).toString('hex');
  const sameYearFormat = (date) =>
    new Intl.DateTimeFormat('en', {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    }).format(date);

  // Posts can be given any creation time through the API, which lets us test old posts
  async function addPostFrom(request, author, content, createdAt) {
    const response = await request.post(`${API}/rest/v1/posts`, {
      headers: authHeaders(author, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      data: { user_id: author.id, content, created_at: createdAt.toISOString() },
    });
    expect(response.ok()).toBe(true);
  }

  test('a new post says "just now" and has the exact time as a tooltip', async ({ page }) => {
    const user = newUser('now');
    await signUp(page, user);
    const text = `Fresh ${user.username}`;
    const before = Date.now();

    await createPost(page, text);

    const time = postCard(page, text).locator('time');
    await expect(time).toHaveText('just now');
    const iso = await time.getAttribute('datetime');
    expect(Date.parse(iso)).toBeGreaterThanOrEqual(before - 5000);
    expect(Date.parse(iso)).toBeLessThanOrEqual(Date.now() + 5000);
    await expect(time).toHaveAttribute('title', new RegExp(String(new Date().getFullYear())));
  });

  test('older posts are described in words, and old ones by date', async ({ page, request }) => {
    const t = tag();
    const author = await createUserNamed(request, `age_${t}`);
    const now = new Date();
    const hoursAgo = (h) => new Date(now.getTime() - h * 3600 * 1000);
    const lastYear = new Date(now.getFullYear() - 1, 5, 15, 12, 0);
    const thirtyDaysAgo = hoursAgo(30 * 24);

    await addPostFrom(request, author, `three hours ${t}`, hoursAgo(3));
    await addPostFrom(request, author, `yesterday ${t}`, hoursAgo(26));
    await addPostFrom(request, author, `two days ${t}`, hoursAgo(50));
    await addPostFrom(request, author, `a month ${t}`, thirtyDaysAgo);
    await addPostFrom(request, author, `last year ${t}`, lastYear);

    await signUp(page, newUser('viewer'));
    await page.goto(`/profile/age_${t}`);

    const timeOf = (text) => postCard(page, text).locator('time');
    await expect(timeOf(`three hours ${t}`)).toHaveText('3 hours ago');
    await expect(timeOf(`yesterday ${t}`)).toHaveText('yesterday');
    await expect(timeOf(`two days ${t}`)).toHaveText('2 days ago');
    await expect(timeOf(`a month ${t}`)).toHaveText(sameYearFormat(thirtyDaysAgo));
    await expect(timeOf(`last year ${t}`)).toHaveText(new RegExp(`Jun 15, ${now.getFullYear() - 1}`));

    // The tooltip always has the exact time
    const full = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(lastYear);
    const title = await timeOf(`last year ${t}`).getAttribute('title');
    expect(title.replace(/\s/g, ' ')).toBe(full.replace(/\s/g, ' '));
  });

  test('the text keeps up with the clock without reloading the page', async ({ page }) => {
    await page.clock.install();
    const user = newUser('tick');
    await signUp(page, user);
    const text = `Ticking ${user.username}`;
    await createPost(page, text);
    const time = postCard(page, text).locator('time');
    await expect(time).toHaveText('just now');

    await page.clock.fastForward('03:00'); // three minutes pass

    await expect(time).toHaveText('3 minutes ago');
  });

  test('notifications show when something happened', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const a = await contextA.newPage();
    const b = await contextB.newPage();
    const userA = newUser('owner');
    const userB = newUser('fan');
    await signUp(a, userA);
    await signUp(b, userB);
    const text = `Notify ${userA.username}`;
    await createPost(a, text);
    await expect(postCard(b, text)).toBeVisible();

    await postCard(b, text).getByRole('button', { name: 'Like post' }).click();
    await bell(a).click();

    const row = a.getByRole('link', { name: new RegExp(`@${userB.username} liked your post`) });
    await expect(row).toBeVisible();
    await expect(row.locator('time')).toHaveText('just now');
    await expect(row.locator('time')).toHaveAttribute('title', /\d{4}/);

    await contextA.close();
    await contextB.close();
  });
});
