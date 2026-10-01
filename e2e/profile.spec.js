import { test, expect } from '@playwright/test';
import { newUser, signUp, createPost, postCard } from './helpers';
import { TINY_PNG } from './api';

const PNG_FILE = { name: 'me.png', mimeType: 'image/png', buffer: TINY_PNG };

async function openOwnProfile(page, user) {
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page).toHaveURL(`/profile/${user.username}`);
}

async function openEditDialog(page) {
  await page.getByRole('button', { name: 'Edit profile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit profile' });
  await expect(dialog).toBeVisible();
  return dialog;
}

function avatarOf(page, username) {
  return page.getByRole('img', { name: `${username}'s avatar` });
}

// "http://127.0.0.1:54321/storage/v1/object/public/avatars/<path>" -> "<path>"
async function avatarPath(image) {
  const src = await image.first().getAttribute('src');
  return decodeURIComponent(new URL(src).pathname.split('/avatars/')[1]);
}

test.describe('profile editing', () => {
  test('a user can edit the display name and bio, and others see them', async ({ page, browser }) => {
    const user = newUser('edit');
    await signUp(page, user);
    await openOwnProfile(page, user);

    // Before editing the heading is the username (the display name defaults to it)
    const dialog = await openEditDialog(page);
    await dialog.getByLabel('Display name').fill('Test Person');
    await dialog.getByLabel('Bio').fill('I test things.\nSecond line.');
    await expect(dialog.getByText('27/160')).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('heading', { name: 'Test Person' })).toBeVisible();
    await expect(page.getByText(`@${user.username}`).first()).toBeVisible();
    await expect(page.getByText('I test things.')).toBeVisible();

    // Still there after a reload
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Test Person' })).toBeVisible();
    await expect(page.getByText('I test things.')).toBeVisible();

    // Another user sees the profile but cannot edit it
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await signUp(other, newUser('viewer'));
    await other.goto(`/profile/${user.username}`);
    await expect(other.getByRole('heading', { name: 'Test Person' })).toBeVisible();
    await expect(other.getByText('I test things.')).toBeVisible();
    await expect(other.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Edit profile' })).toHaveCount(0);
    await otherContext.close();
  });

  test('cancel discards the changes', async ({ page }) => {
    const user = newUser('cancel');
    await signUp(page, user);
    await openOwnProfile(page, user);

    const dialog = await openEditDialog(page);
    await dialog.getByLabel('Display name').fill('Should Not Be Saved');
    await dialog.getByLabel('Bio').fill('Neither should this');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText('Should Not Be Saved')).toHaveCount(0);
    await expect(page.getByText('Neither should this')).toHaveCount(0);

    // Opening the dialog again starts from the saved values
    const again = await openEditDialog(page);
    await expect(again.getByLabel('Bio')).toHaveValue('');
  });
});

test.describe('avatars', () => {
  test('a user can upload, replace and remove a profile picture', async ({ page }) => {
    const user = newUser('avatar');
    await signUp(page, user);
    await openOwnProfile(page, user);

    // No picture yet: the first letter is shown
    await expect(avatarOf(page, user.username)).toHaveCount(0);

    // --- Upload ---
    let dialog = await openEditDialog(page);
    await expect(dialog.getByRole('button', { name: 'Remove photo' })).toBeDisabled();
    await dialog.locator('input[type="file"]').setInputFiles(PNG_FILE);
    await expect(dialog.getByAltText('Profile picture preview')).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    const firstImage = avatarOf(page, user.username).first();
    await expect(firstImage).toBeVisible();
    await expect(firstImage).toHaveJSProperty('naturalWidth', 1); // the image really loaded
    const firstPath = await avatarPath(firstImage);
    expect(firstPath).toMatch(/^[0-9a-f-]{36}\/\d+\.png$/);
    expect((await page.request.get(await firstImage.getAttribute('src'))).status()).toBe(200);

    // --- Replace: the new file gets a new name and the old file is deleted ---
    await page.waitForTimeout(20); // make sure the new timestamp differs
    dialog = await openEditDialog(page);
    await dialog.locator('input[type="file"]').setInputFiles({ ...PNG_FILE, name: 'second.png' });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => avatarPath(avatarOf(page, user.username))).not.toBe(firstPath);
    const secondUrl = await avatarOf(page, user.username).first().getAttribute('src');
    expect((await page.request.get(secondUrl)).status()).toBe(200);
    const oldUrl = secondUrl.replace(/[^/]+$/, firstPath.split('/')[1]);
    expect((await page.request.get(oldUrl)).ok()).toBe(false);

    // --- Remove: back to the first letter, and the file is deleted ---
    dialog = await openEditDialog(page);
    await dialog.getByRole('button', { name: 'Remove photo' }).click();
    await expect(dialog.getByAltText('Profile picture preview')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await expect(avatarOf(page, user.username)).toHaveCount(0);
    expect((await page.request.get(secondUrl)).ok()).toBe(false);
  });

  test('the avatar shows up on posts, also for other users', async ({ page, browser }) => {
    const user = newUser('poster');
    await signUp(page, user);
    await openOwnProfile(page, user);

    const dialog = await openEditDialog(page);
    await dialog.locator('input[type="file"]').setInputFiles(PNG_FILE);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await page.goto('/');
    const text = `Post with a face ${user.username}`;
    await createPost(page, text);
    const ownCard = postCard(page, text);
    await expect(ownCard.getByRole('img', { name: `${user.username}'s avatar` })).toBeVisible();

    // A second user sees the same picture on the post
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await signUp(other, newUser('reader'));
    const seenCard = postCard(other, text);
    await expect(seenCard).toBeVisible();
    const image = seenCard.getByRole('img', { name: `${user.username}'s avatar` });
    await expect(image).toBeVisible();
    await expect(image).toHaveJSProperty('naturalWidth', 1);
    await otherContext.close();
  });

  test('invalid pictures are rejected before anything is uploaded', async ({ page }) => {
    const user = newUser('invalid');
    await signUp(page, user);
    await openOwnProfile(page, user);

    let uploads = 0;
    page.on('request', (request) => {
      if (request.url().includes('/storage/v1/object/avatars')) uploads += 1;
    });

    const dialog = await openEditDialog(page);
    const input = dialog.locator('input[type="file"]');

    await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(dialog.getByText(/JPEG, PNG or WebP/)).toBeVisible();

    await input.setInputFiles({
      name: 'huge.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 1),
    });
    await expect(dialog.getByText(/smaller than 2 MB/)).toBeVisible();
    await expect(dialog.getByAltText('Profile picture preview')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    expect(uploads).toBe(0);
    await expect(avatarOf(page, user.username)).toHaveCount(0);
  });
});
