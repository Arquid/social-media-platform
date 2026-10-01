import { test, expect } from '@playwright/test';
import { newUser, signUp, createPost, postCard, bell } from './helpers';

const NOT_FOUND = /this post does not exist or has been deleted/i;

// B likes A's post and comments on it, which creates notifications for A
async function likeAndComment(page, text, comment) {
  const card = postCard(page, text);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Like post' }).click();
  await expect(card.getByRole('button', { name: 'Unlike post' })).toBeVisible();
  await card.getByRole('button', { name: 'Show comments' }).click();
  await card.getByLabel('Write a comment').fill(comment);
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByText(comment)).toBeVisible();
}

test.describe('post page and notification links', () => {
  test('notifications lead to the post or to the follower\'s profile', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const a = await contextA.newPage();
    const b = await contextB.newPage();
    const userA = newUser('a');
    const userB = newUser('b');
    await signUp(a, userA);
    await signUp(b, userB);

    const text = `Open me ${userA.username}`;
    await createPost(a, text);
    await likeAndComment(b, text, 'Great post from B');

    // B also follows A
    await postCard(b, text).getByRole('link', { name: `@${userA.username}` }).click();
    await b.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(b.getByRole('button', { name: 'Unfollow' })).toBeVisible();
    await expect(bell(a)).toHaveAttribute('aria-label', 'Notifications, 3 unread');

    // --- A clicks the "liked your post" notification ---
    await bell(a).click();
    await a.getByRole('link', { name: new RegExp(`@${userB.username} liked your post`) }).click();
    await expect(a).toHaveURL(/\/post\/\d+$/);

    // The post is shown on its own page, with the comments already open
    const card = postCard(a, text);
    await expect(card).toBeVisible();
    await expect(card.getByText('Great post from B')).toBeVisible();
    await expect(card.getByLabel('Write a comment')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Hide comments' })).toBeVisible();

    // --- The comment notification leads to the same post ---
    const postUrl = a.url();
    await a.goBack();
    await expect(a).toHaveURL(/\/notifications$/);
    await a.getByRole('link', { name: new RegExp(`@${userB.username} commented on your post`) }).click();
    await expect(a).toHaveURL(postUrl);

    // --- The follow notification leads to the follower's profile ---
    await a.goBack();
    await a.getByRole('link', { name: new RegExp(`@${userB.username} started following you`) }).click();
    await expect(a).toHaveURL(`/profile/${userB.username}`);

    await contextA.close();
    await contextB.close();
  });

  test('the post page updates in real time and handles deletion', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const a = await contextA.newPage();
    const b = await contextB.newPage();
    const userA = newUser('owner');
    const userB = newUser('guest');
    await signUp(a, userA);
    await signUp(b, userB);

    const text = `Live post ${userA.username}`;
    await createPost(a, text);

    // B likes the post once, only to get a notification link to the post page
    await expect(postCard(b, text)).toBeVisible();
    await postCard(b, text).getByRole('button', { name: 'Like post' }).click();
    await bell(a).click();
    await a.getByRole('link', { name: new RegExp(`@${userB.username} liked your post`) }).click();
    await expect(a).toHaveURL(/\/post\/\d+$/);
    const postUrl = a.url();

    // Both users have the post page open
    await b.goto(postUrl);
    await expect(postCard(b, text)).toBeVisible();

    // B comments on the page: A sees the comment and the new counter without reloading
    await postCard(b, text).getByLabel('Write a comment').fill('Live comment');
    await postCard(b, text).getByRole('button', { name: 'Send' }).click();
    await expect(postCard(a, text).getByText('Live comment')).toBeVisible();
    // 1 like and 1 comment
    await expect(postCard(a, text).getByText('1', { exact: true })).toHaveCount(2);

    // A deletes the post from its own page and is sent back to the feed
    await postCard(a, text).getByRole('button', { name: 'Delete post' }).click();
    await expect(a).toHaveURL('/');
    await expect(postCard(a, text)).toHaveCount(0);

    // B's open page learns that the post is gone
    await expect(b.getByText(NOT_FOUND)).toBeVisible();

    await contextA.close();
    await contextB.close();
  });

  test('unknown posts show a message and a way back', async ({ page }) => {
    await signUp(page, newUser('lost'));

    for (const id of ['abc', '99999999']) {
      await page.goto(`/post/${id}`);
      await expect(page.getByText(NOT_FOUND)).toBeVisible();
    }

    await page.getByRole('link', { name: 'Back to the feed' }).click();
    await expect(page).toHaveURL('/');
  });

  test('a visitor who is not logged in is sent to the login page', async ({ page }) => {
    await page.goto('/post/1');
    await expect(page).toHaveURL(/\/login$/);
  });
});
