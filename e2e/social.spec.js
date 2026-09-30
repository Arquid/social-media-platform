import { test, expect } from '@playwright/test';
import { newUser, signUp, createPost, postCard, bell } from './helpers';

test('two users post, like, comment, follow and get notified in real time', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();

  const userA = newUser('a');
  const userB = newUser('b');
  await signUp(a, userA);
  await signUp(b, userB);

  // --- A posts; B sees it appear without reloading ---
  const postA = `Post by A ${userA.username}`;
  await createPost(a, postA);
  await expect(postCard(b, postA)).toBeVisible();

  // --- B likes and comments; A's card and bell update live ---
  const cardForB = postCard(b, postA);
  await cardForB.getByRole('button', { name: 'Like post' }).click();
  await expect(cardForB.getByRole('button', { name: 'Unlike post' })).toBeVisible();
  await expect(bell(a)).toHaveAttribute('aria-label', 'Notifications, 1 unread');

  await cardForB.getByRole('button', { name: 'Show comments' }).click();
  await cardForB.getByLabel('Write a comment').fill('Nice one!');
  await cardForB.getByRole('button', { name: 'Send' }).click();
  await expect(cardForB.getByText('Nice one!')).toBeVisible();
  await expect(bell(a)).toHaveAttribute('aria-label', 'Notifications, 2 unread');

  // The counters on A's own card (1 like, 1 comment) updated by themselves
  await expect(postCard(a, postA).getByText('1', { exact: true })).toHaveCount(2);

  // --- B follows A from A's profile page ---
  await cardForB.getByRole('link', { name: `@${userA.username}` }).click();
  await expect(b).toHaveURL(`/profile/${userA.username}`);
  await b.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Unfollow' })).toBeVisible();
  await expect(b.getByText('1 followers')).toBeVisible();
  await expect(bell(a)).toHaveAttribute('aria-label', 'Notifications, 3 unread');

  // --- A reads the notifications; the badge clears ---
  await bell(a).click();
  await expect(a).toHaveURL(/\/notifications$/);
  await expect(a.getByText(`@${userB.username} liked your post`)).toBeVisible();
  await expect(a.getByText(`@${userB.username} commented on your post`)).toBeVisible();
  await expect(a.getByText(`@${userB.username} started following you`)).toBeVisible();
  await expect(bell(a)).toHaveAttribute('aria-label', 'Notifications');

  // --- A follows B and sees B's new post on the Following tab in real time ---
  await a.goto(`/profile/${userB.username}`);
  await a.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(a.getByRole('button', { name: 'Unfollow' })).toBeVisible();

  await a.goto('/');
  await a.getByRole('tab', { name: 'Following' }).click();

  const postB = `Post by B ${userB.username}`;
  await b.goto('/');
  await createPost(b, postB);
  await expect(postCard(a, postB)).toBeVisible();
  // A's own post is not on the Following tab
  await expect(postCard(a, postA)).toHaveCount(0);

  // --- A deletes their post; it disappears for B without reloading ---
  await a.getByRole('tab', { name: 'All' }).click();
  await expect(postCard(a, postA)).toBeVisible();
  await postCard(a, postA).getByRole('button', { name: 'Delete post' }).click();
  await expect(postCard(a, postA)).toHaveCount(0);
  await expect(postCard(b, postA)).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

test('a user can unlike a post and the counter goes back to zero', async ({ page }) => {
  const user = newUser('like');
  await signUp(page, user);

  const text = `Likeable ${user.username}`;
  await createPost(page, text);
  const card = postCard(page, text);

  await card.getByRole('button', { name: 'Like post' }).click();
  await expect(card.getByRole('button', { name: 'Unlike post' })).toBeVisible();
  await expect(card.getByText('1', { exact: true })).toHaveCount(1);

  await card.getByRole('button', { name: 'Unlike post' }).click();
  await expect(card.getByRole('button', { name: 'Like post' })).toBeVisible();
  await expect(card.getByText('1', { exact: true })).toHaveCount(0);
});
