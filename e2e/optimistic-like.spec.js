import { test, expect } from '@playwright/test';
import { newUser, signUp, createPost, postCard } from './helpers';

const LIKES_URL = '**/rest/v1/likes*';
const SLOW_MS = 2500;

// Signs up, creates a post and returns its card and text
async function setup(page, prefix) {
  const user = newUser(prefix);
  await signUp(page, user);
  const text = `Optimistic ${user.username}`;
  await createPost(page, text);
  return { card: postCard(page, text), text };
}

// The post has 0 likes and 0 comments, so the card contains two "0" counters
const zeroCounters = (card) => card.getByText('0', { exact: true });
const oneCounters = (card) => card.getByText('1', { exact: true });

test.describe('optimistic like', () => {
  test('the like shows immediately while the server is slow', async ({ page }) => {
    const { card, text } = await setup(page, 'slow');
    await expect(zeroCounters(card)).toHaveCount(2);

    // Delay every like request so we can look at the screen while it is still open
    let answered = false;
    await page.route(LIKES_URL, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      await route.continue();
      answered = true;
    });

    await card.getByRole('button', { name: 'Like post' }).click();

    // Visible far sooner than the delay, so it cannot come from the server's answer
    await expect(card.getByRole('button', { name: 'Unlike post' })).toBeVisible({ timeout: 700 });
    await expect(oneCounters(card)).toHaveCount(1);
    expect(answered).toBe(false);

    // It stays like that when the answer arrives (no flicker back to 0)
    await page.waitForResponse((response) => response.url().includes('/rest/v1/likes'));
    await expect(card.getByRole('button', { name: 'Unlike post' })).toBeVisible();
    await expect(oneCounters(card)).toHaveCount(1);

    // ...and it was really saved
    await page.unroute(LIKES_URL);
    await page.reload();
    const reloaded = postCard(page, text);
    await expect(reloaded).toBeVisible();
    await expect(reloaded.getByRole('button', { name: 'Unlike post' })).toBeVisible();
    await expect(oneCounters(reloaded)).toHaveCount(1);
  });

  test('unliking also shows immediately', async ({ page }) => {
    const { card } = await setup(page, 'unlike');
    await card.getByRole('button', { name: 'Like post' }).click();
    await expect(card.getByRole('button', { name: 'Unlike post' })).toBeVisible();
    await expect(oneCounters(card)).toHaveCount(1);

    await page.route(LIKES_URL, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      await route.continue();
    });
    await card.getByRole('button', { name: 'Unlike post' }).click();

    await expect(card.getByRole('button', { name: 'Like post' })).toBeVisible({ timeout: 700 });
    await expect(zeroCounters(card)).toHaveCount(2);
  });

  test('the like is undone and an error is shown when the server fails', async ({ page }) => {
    const { card } = await setup(page, 'fail');

    await page.route(LIKES_URL, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 800));
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'database is on fire' }),
      });
    });

    await card.getByRole('button', { name: 'Like post' }).click();

    // First the optimistic result...
    await expect(card.getByRole('button', { name: 'Unlike post' })).toBeVisible({ timeout: 700 });
    await expect(oneCounters(card)).toHaveCount(1);

    // ...then the failure: it is undone and the user is told
    await expect(page.getByText('Could not update like: database is on fire')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Like post' })).toBeVisible();
    await expect(zeroCounters(card)).toHaveCount(2);

    // Trying again after the problem is gone works
    await page.unroute(LIKES_URL);
    await card.getByRole('button', { name: 'Like post' }).click();
    await expect(card.getByRole('button', { name: 'Unlike post' })).toBeVisible();
    await expect(oneCounters(card)).toHaveCount(1);
  });

  test('clicking again while the first click is being saved sends only one request', async ({ page }) => {
    const { card } = await setup(page, 'double');

    const requests = [];
    await page.route(LIKES_URL, async (route) => {
      requests.push(route.request().method());
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });

    await card.getByRole('button', { name: 'Like post' }).click();
    await card.getByRole('button', { name: 'Unlike post' }).click({ force: true });
    await card.getByRole('button', { name: 'Unlike post' }).click({ force: true });

    await expect(card.getByRole('button', { name: 'Unlike post' })).toBeVisible();
    await page.waitForResponse((response) => response.url().includes('/rest/v1/likes'));
    await expect(oneCounters(card)).toHaveCount(1);
    expect(requests).toEqual(['POST']);
  });
});
