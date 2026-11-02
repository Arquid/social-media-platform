import { test, expect } from '@playwright/test';
import { newUser, signUp, createPost, postCard } from './helpers';

// A post the user writes must appear at once. It used to show up only when the realtime
// message came back, so a slow or broken realtime connection made it look like nothing happened.

const firstPostText = (page) => page.locator('.MuiCard-root').first().textContent();

test('your own post appears at once even if realtime does not work at all', async ({ page }) => {
  // Every realtime connection is closed straight away
  await page.routeWebSocket(/\/realtime\//, (socket) => socket.close());
  await signUp(page, newUser('own'));

  await createPost(page, 'first without realtime');
  await createPost(page, 'second without realtime');

  // The newest post is on top
  expect(await firstPostText(page)).toContain('second without realtime');
});

test('the post is on the page once, also after realtime has reported it', async ({ page }) => {
  const text = `shown once ${Date.now()}`;
  let realtimeReported = false;
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => {
      if (String(frame.payload).includes(text)) realtimeReported = true;
    });
  });
  await signUp(page, newUser('once'));

  await createPost(page, text);

  // Wait until the realtime message about this very post has arrived
  await expect.poll(() => realtimeReported, { message: 'realtime message arrived' }).toBe(true);
  await expect(postCard(page, text)).toHaveCount(1);
});

test('the post stays on top after switching tabs, and the Following tab does not show it', async ({ page }) => {
  await page.routeWebSocket(/\/realtime\//, (socket) => socket.close());
  await signUp(page, newUser('tabs'));
  await createPost(page, 'tab switch post');

  await page.getByRole('tab', { name: 'Following' }).click();
  await expect(page.getByText('No posts yet.')).toBeVisible();

  await page.getByRole('tab', { name: 'All' }).click();
  await expect(postCard(page, 'tab switch post')).toHaveCount(1);
});

test('after a reload the post is still there exactly once', async ({ page }) => {
  await signUp(page, newUser('reload'));
  await createPost(page, 'survives a reload');

  await page.reload();

  await expect(postCard(page, 'survives a reload')).toHaveCount(1);
});
