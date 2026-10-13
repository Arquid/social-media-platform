import { test, expect } from '@playwright/test';
import { newUser, signUp, createPost, postCard } from './helpers';
import { ageRateLimitEvents } from './api';

// The same limits as in rate-limit.spec.js, but seen through the web app
const POST_LIMIT = 10;
const COMMENT_LIMIT = 20;

const POST_MESSAGE = 'You are posting too fast. Please wait a minute and try again.';
const COMMENT_MESSAGE = 'You are commenting too fast. Please wait a minute and try again.';

// A comment is shown as "@author text" in one element, so match the end of the line
// ("comment 1" must not match "comment 11")
const commentText = (card, n) => card.getByText(new RegExp(`comment ${n}$`));

const box = (page) => page.getByPlaceholder("What's on your mind?");
const postButton = (page) => page.getByRole('button', { name: 'Post', exact: true });

test.describe('post limit in the app', () => {
  test('the 11th post shows a warning and keeps the text, and works again after a minute', async ({ page }) => {
    const user = newUser('limit');
    await signUp(page, user);
    // The feed is shared by everyone, so every text carries this user's name
    const eleventh = `Post number eleven ${user.username}`;

    for (let i = 1; i <= POST_LIMIT; i += 1) {
      await createPost(page, `Quick post ${i} ${user.username}`);
    }

    // --- The 11th post is refused ---
    await box(page).fill(eleventh);
    await postButton(page).click();

    const warning = page.getByRole('alert').filter({ hasText: POST_MESSAGE });
    await expect(warning).toBeVisible();
    // A yellow warning, not a red error: the user did nothing wrong
    await expect(warning).toHaveClass(/MuiAlert-\w*Warning/);
    // The text is still in the box and nothing was published
    await expect(box(page)).toHaveValue(eleventh);
    await expect(postCard(page, eleventh)).toHaveCount(0);
    await expect(postButton(page)).toBeEnabled();

    // --- A minute later the same text can be sent ---
    ageRateLimitEvents();
    await postButton(page).click();

    await expect(postCard(page, eleventh)).toBeVisible();
    await expect(box(page)).toHaveValue('');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('someone who has not reached the limit is not warned', async ({ page }) => {
    const user = newUser('calm');
    await signUp(page, user);

    await createPost(page, `Just one post ${user.username}`);

    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('comment limit in the app', () => {
  test('the 21st comment shows a warning toast without an error prefix, and works again after a minute', async ({ page }) => {
    const user = newUser('talk');
    await signUp(page, user);
    const text = `Lots of talk ${user.username}`;
    await createPost(page, text);

    const card = postCard(page, text);
    await card.getByRole('button', { name: 'Show comments' }).click();
    const commentBox = card.getByRole('textbox', { name: 'Write a comment' });

    for (let i = 1; i <= COMMENT_LIMIT; i += 1) {
      await commentBox.fill(`comment ${i}`);
      await card.getByRole('button', { name: 'Send' }).click();
      await expect(commentText(card, i)).toBeVisible();
    }

    // --- The 21st comment is refused ---
    await commentBox.fill('comment 21');
    await card.getByRole('button', { name: 'Send' }).click();

    const toast = page.getByRole('alert').filter({ hasText: COMMENT_MESSAGE });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveClass(/MuiAlert-\w*Warning/);
    // The message is shown as it is, without "Could not add comment:" in front of it
    await expect(page.getByText(/Could not add comment/)).toHaveCount(0);
    await expect(commentBox).toHaveValue('comment 21');
    await expect(commentText(card, 21)).toHaveCount(0);

    // --- A minute later it works ---
    ageRateLimitEvents();
    await card.getByRole('button', { name: 'Send' }).click();

    await expect(commentText(card, 21)).toBeVisible();
    await expect(commentBox).toHaveValue('');
  });
});
