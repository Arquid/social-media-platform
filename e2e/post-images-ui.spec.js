import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { API, TINY_PNG, createUser, authHeaders, uploadAvatar, patchProfile, publicPostImageUrl, runSql } from './api';
import { newUser, signUp, createPost, postCard, listenToFrames, waitForSubscription } from './helpers';

// Pictures in posts, and the avatars next to comments, in a real browser.
// (What the storage and the database allow: post-images.spec.js.)

const tag = () => randomBytes(3).toString('hex');
const picture = { name: 'photo.png', mimeType: 'image/png', buffer: TINY_PNG };
const fileInput = (page) => page.locator('input[type="file"]');
const textBox = (page) => page.getByPlaceholder("What's on your mind?");
const postButton = (page) => page.getByRole('button', { name: 'Post', exact: true });
const imageOf = (card) => card.getByRole('img', { name: /Picture in the post of/ });

async function postWithPicture(page, text, file = picture) {
  await fileInput(page).setInputFiles(file);
  await expect(page.getByRole('img', { name: 'Picture to be posted' })).toBeVisible();
  await textBox(page).fill(text);
  await postButton(page).click();
  await expect(postCard(page, text)).toBeVisible();
}

const storedPath = (text) => runSql(`select image_path from posts where content = '${text}';`).trim();

test.describe('a post with a picture', () => {
  test('shows a preview, then the picture in the post, also after a reload', async ({ page }) => {
    await signUp(page, newUser('pic'));
    const text = `post with a picture ${tag()}`;

    await postWithPicture(page, text);

    const picture = imageOf(postCard(page, text));
    await expect(picture).toBeVisible();
    await expect(picture).toHaveAttribute('src', /\/storage\/v1\/object\/public\/post-images\/.+\.png$/);
    // It is really loaded: the picture has a size
    await expect.poll(() => picture.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    // The form is empty again
    await expect(page.getByRole('img', { name: 'Picture to be posted' })).toHaveCount(0);
    await expect(textBox(page)).toHaveValue('');

    await page.reload();
    await expect.poll(() => imageOf(postCard(page, text)).evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  });

  test('the picture is saved in the folder of the author', async ({ page }) => {
    const user = newUser('picown');
    await signUp(page, user);
    const text = `folder check ${tag()}`;
    const id = runSql(`select id from profiles where username = '${user.username}';`).trim();

    await postWithPicture(page, text);

    expect(storedPath(text)).toMatch(new RegExp(`^${id}/\\d+\\.png$`));
  });

  test('the picture can be removed before posting, and the post then has none', async ({ page }) => {
    await signUp(page, newUser('picrem'));
    const text = `changed my mind ${tag()}`;
    await fileInput(page).setInputFiles(picture);
    await expect(page.getByRole('img', { name: 'Picture to be posted' })).toBeVisible();

    await page.getByRole('button', { name: 'Remove picture' }).click();
    await expect(page.getByRole('img', { name: 'Picture to be posted' })).toHaveCount(0);
    await createPost(page, text);

    await expect(imageOf(postCard(page, text))).toHaveCount(0);
    expect(storedPath(text)).toBe('');
  });

  test('a file that is not a picture, and one that is too big, are refused with a message', async ({ page }) => {
    await signUp(page, newUser('picbad'));
    const before = Number(runSql('select count(*) from posts;').trim());

    await fileInput(page).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('words') });
    await expect(page.getByRole('alert')).toContainText('Please choose a JPEG, PNG or WebP picture.');
    await expect(page.getByRole('img', { name: 'Picture to be posted' })).toHaveCount(0);

    await fileInput(page).setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1) });
    await expect(page.getByRole('alert')).toContainText('The picture must be smaller than 5 MB.');
    await expect(page.getByRole('img', { name: 'Picture to be posted' })).toHaveCount(0);

    expect(Number(runSql('select count(*) from posts;').trim())).toBe(before);
  });

  test('other people see it, also without reloading', async ({ page, browser }) => {
    await signUp(page, newUser('picauth'));
    const readerContext = await browser.newContext();
    const reader = await readerContext.newPage();
    const frames = listenToFrames(reader);
    await signUp(reader, newUser('picread'));
    await reader.goto('/');
    await waitForSubscription(reader, frames, 'realtime:feed-1');
    const text = `shown to everybody ${tag()}`;

    await postWithPicture(page, text);

    await expect(postCard(reader, text)).toBeVisible();
    await expect.poll(() => imageOf(postCard(reader, text)).evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    await readerContext.close();
  });

  test('is shown on the page of the post and on the profile too', async ({ page }) => {
    const user = newUser('picpages');
    await signUp(page, user);
    const text = `on every page ${tag()}`;
    await postWithPicture(page, text);
    const id = runSql(`select id from posts where content = '${text}';`).trim();

    await page.goto(`/post/${id}`);
    await expect(imageOf(page.locator('.MuiCard-root').first())).toBeVisible();

    await page.goto(`/profile/${user.username}`);
    await expect(imageOf(postCard(page, text))).toBeVisible();
  });

  test('stays when the text is edited', async ({ page }) => {
    await signUp(page, newUser('picedit'));
    const text = `edit me ${tag()}`;
    await postWithPicture(page, text);
    const before = storedPath(text);

    await postCard(page, text).getByRole('button', { name: 'Edit post' }).click();
    await expect(imageOf(page.locator('.MuiCard-root', { has: page.getByRole('textbox', { name: 'Edit post text' }) }))).toBeVisible();
    await page.getByRole('textbox', { name: 'Edit post text' }).fill(`edited ${text}`);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(postCard(page, `edited ${text}`)).toBeVisible();
    await expect(imageOf(postCard(page, `edited ${text}`))).toBeVisible();
    expect(storedPath(`edited ${text}`)).toBe(before);
  });

  test('deleting the post also removes the file from the storage', async ({ page, request }) => {
    await signUp(page, newUser('picdel'));
    const text = `delete me ${tag()}`;
    await postWithPicture(page, text);
    const path = storedPath(text);
    expect((await request.get(publicPostImageUrl(path))).ok()).toBe(true);

    await postCard(page, text).getByRole('button', { name: 'Delete post' }).click();

    await expect(postCard(page, text)).toHaveCount(0);
    await expect.poll(async () => (await request.get(publicPostImageUrl(path))).ok()).toBe(false);
  });

  test('a post with a picture that cannot be saved leaves no file behind', async ({ page, request }) => {
    await signUp(page, newUser('picfail'));
    const text = `will fail ${tag()}`;
    // The database refuses the post (the request is answered with an error before it gets there)
    await page.route('**/rest/v1/posts*', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '23514', message: 'database says no' }) })
        : route.continue()
    );
    let uploaded = null;
    page.on('response', async (response) => {
      if (response.url().includes('/storage/v1/object/post-images/') && response.request().method() === 'POST') {
        uploaded = response.url().split('/post-images/')[1];
      }
    });

    await fileInput(page).setInputFiles(picture);
    await textBox(page).fill(text);
    await postButton(page).click();

    await expect(page.getByRole('alert')).toContainText('database says no');
    await expect.poll(() => uploaded).not.toBeNull();
    // The file was uploaded, and then removed again
    await expect.poll(async () => (await request.get(publicPostImageUrl(uploaded))).ok()).toBe(false);
    // The text and the picture are still in the form for another try
    await expect(textBox(page)).toHaveValue(text);
    await expect(page.getByRole('img', { name: 'Picture to be posted' })).toBeVisible();
  });
});

test.describe('avatars next to comments', () => {
  test('a comment shows the picture of its author, or the first letter when there is none', async ({ page, request }) => {
    const author = newUser('cavatar');
    await signUp(page, author);
    const text = `comment avatars ${tag()}`;
    await createPost(page, text);
    const postId = runSql(`select id from posts where content = '${text}';`).trim();

    // A commenter with a profile picture, and one without
    const withPicture = await createUser(request, 'cavpic');
    const path = `${withPicture.id}/face.png`;
    await uploadAvatar(request, withPicture, path);
    await patchProfile(request, withPicture, { avatar_path: path });
    const plain = await createUser(request, 'cavplain');
    for (const [who, content] of [[withPicture, 'from the one with a picture'], [plain, 'from the one without']]) {
      await request.post(`${API}/rest/v1/comments`, {
        headers: authHeaders(who, { 'Content-Type': 'application/json' }),
        data: { post_id: Number(postId), user_id: who.id, content },
      });
    }

    await page.goto(`/post/${postId}`);

    const pictureRow = page.getByText('from the one with a picture').locator('..');
    const avatar = pictureRow.getByRole('img', { name: `${withPicture.username}'s avatar` });
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveAttribute('src', /\/storage\/v1\/object\/public\/avatars\//);
    // No picture: the first letter of the name in a circle
    const plainRow = page.getByText('from the one without').locator('..');
    await expect(plainRow.getByText(plain.username[0].toUpperCase(), { exact: true })).toBeVisible();
    await expect(plainRow.getByRole('img')).toHaveCount(0);
  });
});
