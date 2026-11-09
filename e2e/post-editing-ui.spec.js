import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { runSql } from './api';
import { newUser, signUp, createPost, postCard, listenToFrames, waitForSubscription } from './helpers';

// Editing a post and deleting a comment in a real browser. (What the database allows is tested in
// edit-post.spec.js and privileges.spec.js.)

const tag = () => randomBytes(3).toString('hex');
const postIdOf = (text) => Number(runSql(`select id from posts where content = '${text}';`).trim());

// While the box is open the old text is in the box and no longer on the card, so a card found by its
// text is gone. The box and its buttons are therefore looked for on the whole page (only one is open).
async function editPost(card, newText) {
  const page = card.page();
  await card.getByRole('button', { name: 'Edit post' }).click();
  await page.getByRole('textbox', { name: 'Edit post text' }).fill(newText);
  await page.getByRole('button', { name: 'Save' }).click();
}

test.describe('editing a post', () => {
  test('shows the new text and an "edited" mark, also after a reload', async ({ page }) => {
    await signUp(page, newUser('edit'));
    const text = `first version ${tag()}`;
    const edited = `second version ${tag()}`;
    await createPost(page, text);
    // (the feed is shared with other tests, so look at the card of this post only)
    await expect(postCard(page, text).getByText('· edited')).toHaveCount(0);

    await editPost(postCard(page, text), edited);

    await expect(page.getByText(edited)).toBeVisible();
    await expect(page.getByText(text)).toHaveCount(0);
    await expect(postCard(page, edited).getByText('· edited')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Edit post text' })).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(edited)).toBeVisible();
    await expect(postCard(page, edited).getByText('· edited')).toBeVisible();
  });

  test('Cancel keeps the old text, and saving the same text does not mark the post as edited', async ({ page }) => {
    await signUp(page, newUser('editno'));
    const text = `unchanged ${tag()}`;
    await createPost(page, text);
    const card = postCard(page, text);

    await card.getByRole('button', { name: 'Edit post' }).click();
    await page.getByRole('textbox', { name: 'Edit post text' }).fill('something else entirely');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(card.getByText(text)).toBeVisible();

    await card.getByRole('button', { name: 'Edit post' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByText(text)).toBeVisible();
    await expect(card.getByText('· edited')).toHaveCount(0);
  });

  test('only your own posts have an edit button', async ({ page, browser }) => {
    const mineText = `my post ${tag()}`;
    const theirText = `their post ${tag()}`;
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await signUp(otherPage, newUser('editother'));
    await createPost(otherPage, theirText);
    await signUp(page, newUser('editmine'));
    await createPost(page, mineText);

    await page.goto('/');

    await expect(postCard(page, mineText).getByRole('button', { name: 'Edit post' })).toBeVisible();
    await expect(postCard(page, theirText)).toBeVisible();
    await expect(postCard(page, theirText).getByRole('button', { name: 'Edit post' })).toHaveCount(0);
    await otherContext.close();
  });

  test('other people who have the post on the screen see the edit without reloading', async ({ page, browser }) => {
    const author = newUser('editlive');
    await signUp(page, author);
    const text = `before ${tag()}`;
    await createPost(page, text);

    const readerContext = await browser.newContext();
    const reader = await readerContext.newPage();
    const frames = listenToFrames(reader);
    await signUp(reader, newUser('editread'));
    await reader.goto('/');
    await expect(postCard(reader, text)).toBeVisible();
    await waitForSubscription(reader, frames, 'feed-activity');

    const after = `after ${tag()}`;
    await editPost(postCard(page, text), after);

    await expect(reader.getByText(after)).toBeVisible();
    await expect(reader.getByText(text)).toHaveCount(0);
    await expect(postCard(reader, after).getByText('· edited')).toBeVisible();
    await readerContext.close();
  });

  test('works on the page of the post and on the profile page, and the post page follows an edit', async ({ page, browser }) => {
    const author = newUser('editpages');
    await signUp(page, author);
    const text = `pages ${tag()}`;
    await createPost(page, text);
    const id = postIdOf(text);

    // On the page of the post
    await page.goto(`/post/${id}`);
    await editPost(page.locator('.MuiCard-root').first(), `on the post page ${tag()}`);
    await expect(page.getByText(/on the post page/)).toBeVisible();
    await expect(page.getByText('· edited')).toBeVisible();

    // On the profile page
    await page.goto(`/profile/${author.username}`);
    await editPost(postCard(page, 'on the post page'), `on the profile ${tag()}`);
    await expect(page.getByText(/on the profile/)).toBeVisible();

    // Somebody who has the post page open sees the edit
    const readerContext = await browser.newContext();
    const reader = await readerContext.newPage();
    const frames = listenToFrames(reader);
    await signUp(reader, newUser('editpgrd'));
    await reader.goto(`/post/${id}`);
    await expect(reader.getByText(/on the profile/)).toBeVisible();
    await waitForSubscription(reader, frames, 'post-');
    await editPost(postCard(page, 'on the profile'), `edited again ${tag()}`);
    await expect(reader.getByText(/edited again/)).toBeVisible();
    await readerContext.close();
  });

  test('a text of more than 500 characters cannot be typed', async ({ page }) => {
    await signUp(page, newUser('editlen'));
    const text = `length ${tag()}`;
    await createPost(page, text);
    await postCard(page, text).getByRole('button', { name: 'Edit post' }).click();
    const box = page.getByRole('textbox', { name: 'Edit post text' });

    await box.fill('x'.repeat(600));

    await expect(box).toHaveValue('x'.repeat(500));
  });
});

test.describe('deleting a comment', () => {
  test('removes it, lowers the number of comments and shows delete buttons on the own comments only', async ({ page, browser }) => {
    const author = newUser('cdel');
    await signUp(page, author);
    const text = `comment post ${tag()}`;
    await createPost(page, text);
    const id = postIdOf(text);

    // Somebody else comments first
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await signUp(other, newUser('cdelother'));
    await other.goto(`/post/${id}`);
    await other.getByRole('textbox', { name: 'Write a comment' }).fill('the comment of somebody else');
    await other.getByRole('button', { name: 'Send' }).click();
    await expect(other.getByText('the comment of somebody else')).toBeVisible();

    await page.goto(`/post/${id}`);
    await page.getByRole('textbox', { name: 'Write a comment' }).fill('my own comment');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('my own comment')).toBeVisible();
    const card = page.locator('.MuiCard-root').first();
    await expect(card.getByText('2', { exact: true })).toBeVisible(); // two comments

    // A delete button on my comment, none on the other one
    await expect(page.getByRole('button', { name: 'Delete comment' })).toHaveCount(1);
    await expect(page.getByText('my own comment').locator('..').getByRole('button', { name: 'Delete comment' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete comment' }).click();

    await expect(page.getByText('my own comment')).toHaveCount(0);
    await expect(page.getByText('the comment of somebody else')).toBeVisible();
    await expect(card.getByText('1', { exact: true })).toBeVisible(); // one comment left
    await expect(page.getByRole('button', { name: 'Delete comment' })).toHaveCount(0);

    // It is gone for good
    await page.reload();
    await expect(page.getByText('my own comment')).toHaveCount(0);
    await otherContext.close();
  });

  test('disappears from the screen of somebody else who is reading the comments', async ({ page, browser }) => {
    await signUp(page, newUser('cdellive'));
    const text = `live comment post ${tag()}`;
    await createPost(page, text);
    const id = postIdOf(text);
    await page.goto(`/post/${id}`);
    await page.getByRole('textbox', { name: 'Write a comment' }).fill('a comment that will go');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('a comment that will go')).toBeVisible();

    const readerContext = await browser.newContext();
    const reader = await readerContext.newPage();
    const frames = listenToFrames(reader);
    await signUp(reader, newUser('cdelread'));
    await reader.goto(`/post/${id}`);
    await expect(reader.getByText('a comment that will go')).toBeVisible();
    await waitForSubscription(reader, frames, 'comments-');

    await page.getByRole('button', { name: 'Delete comment' }).click();

    await expect(reader.getByText('a comment that will go')).toHaveCount(0);
    await readerContext.close();
  });

  test('can be done under a post in the feed too', async ({ page }) => {
    await signUp(page, newUser('cdelfeed'));
    const text = `feed comment post ${tag()}`;
    await createPost(page, text);
    const card = postCard(page, text);
    await card.getByRole('button', { name: 'Show comments' }).click();
    await card.getByRole('textbox', { name: 'Write a comment' }).fill('delete me from the feed');
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(card.getByText('delete me from the feed')).toBeVisible();

    await card.getByRole('button', { name: 'Delete comment' }).click();

    await expect(card.getByText('delete me from the feed')).toHaveCount(0);
  });
});
