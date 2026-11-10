import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import {
  API, KEY, createUser, authHeaders, uploadAvatar, publicAvatarUrl, patchProfile, runSql,
  uploadPostImage, publicPostImageUrl,
} from './api';
import { newUser, signUp, createPost, postCard } from './helpers';

// A user deletes their own account from the profile page. The database function does the work;
// these tests follow the whole path in a real browser and then look into the database, the
// storage and a second browser to see that everything is gone, and that nothing else is.

const json = { 'Content-Type': 'application/json', Prefer: 'return=minimal' };
const tag = () => randomBytes(3).toString('hex');
const count = (sql) => Number(runSql(sql).trim());

// The page signs the user up through the form, so the API token is fetched with the same password
async function apiSessionOf(request, user, id) {
  const response = await request.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    data: { email: user.email, password: user.password },
  });
  return { id, token: (await response.json()).access_token };
}

const idOf = (user) => runSql(`select id from profiles where username = '${user.username}';`).trim();

// Everything that belongs to one account, in one line
function leftOf(id) {
  return runSql(`
    select (select count(*) from auth.users where id = '${id}') || ' users, '
        || (select count(*) from profiles where id = '${id}') || ' profiles, '
        || (select count(*) from posts where user_id = '${id}') || ' posts, '
        || (select count(*) from comments where user_id = '${id}') || ' comments, '
        || (select count(*) from likes where user_id = '${id}') || ' likes, '
        || (select count(*) from follows where follower_id = '${id}' or following_id = '${id}') || ' follows, '
        || (select count(*) from notifications where user_id = '${id}' or actor_id = '${id}') || ' notifications, '
        || (select count(*) from rate_limit_events where user_id = '${id}') || ' log rows, '
        || (select count(*) from storage.objects where bucket_id in ('avatars', 'post-images') and name like '${id}/%') || ' pictures';
  `).trim();
}
const NOTHING = '0 users, 0 profiles, 0 posts, 0 comments, 0 likes, 0 follows, 0 notifications, 0 log rows, 0 pictures';

async function openDeleteDialog(page, user) {
  await page.goto(`/profile/${user.username}`);
  await page.getByRole('button', { name: 'Delete account' }).click();
  return page.getByRole('dialog', { name: 'Delete your account?' });
}

test('deleting an account removes everything of the user, and nothing of the others', async ({ page, browser, request }) => {
  // --- the user who will leave, and a friend who stays and watches in another browser ---
  const leaver = newUser('leave');
  await signUp(page, leaver);
  const leaverId = idOf(leaver);
  const leaverApi = await apiSessionOf(request, leaver, leaverId);

  const friendContext = await browser.newContext();
  const friendPage = await friendContext.newPage();
  const friend = newUser('stay');
  await signUp(friendPage, friend);
  const friendId = idOf(friend);
  const friendApi = await apiSessionOf(request, friend, friendId);

  // --- they have a picture, a post, a comment, a like, and follow each other ---
  const picture = `${leaverId}/${Date.now()}.png`;
  expect((await uploadAvatar(request, leaverApi, picture)).ok()).toBe(true);
  expect((await patchProfile(request, leaverApi, { avatar_path: picture })).ok()).toBe(true);
  expect((await request.get(publicAvatarUrl(picture))).ok()).toBe(true);
  // ... and a post with a picture of its own, which is a file in the other bucket
  const postPicture = `${leaverId}/${Date.now() + 1}.png`;
  expect((await uploadPostImage(request, leaverApi, postPicture)).ok()).toBe(true);
  expect((await request.post(`${API}/rest/v1/posts`, {
    headers: authHeaders(leaverApi, json),
    data: { user_id: leaverId, content: `leaver post with a picture ${tag()}`, image_path: postPicture },
  })).ok()).toBe(true);
  expect((await request.get(publicPostImageUrl(postPicture))).ok()).toBe(true);

  const leaversPost = `leaver post ${tag()}`;
  await page.goto('/');
  await createPost(page, leaversPost);
  const friendsPost = `friend post ${tag()}`;
  await friendPage.goto('/');
  await createPost(friendPage, friendsPost);
  const friendsPostId = Number(runSql(`select id from posts where content = '${friendsPost}';`).trim());
  const leaversPostId = Number(runSql(`select id from posts where content = '${leaversPost}';`).trim());

  await request.post(`${API}/rest/v1/likes`, { headers: authHeaders(leaverApi, json), data: { post_id: friendsPostId, user_id: leaverId } });
  await request.post(`${API}/rest/v1/comments`, { headers: authHeaders(leaverApi, json), data: { post_id: friendsPostId, user_id: leaverId, content: 'from the leaver' } });
  await request.post(`${API}/rest/v1/follows`, { headers: authHeaders(leaverApi, json), data: { follower_id: leaverId, following_id: friendId } });
  await request.post(`${API}/rest/v1/likes`, { headers: authHeaders(friendApi, json), data: { post_id: leaversPostId, user_id: friendId } });
  await request.post(`${API}/rest/v1/follows`, { headers: authHeaders(friendApi, json), data: { follower_id: friendId, following_id: leaverId } });

  expect(leftOf(leaverId)).not.toBe(NOTHING);
  await friendPage.goto('/');
  await expect(postCard(friendPage, leaversPost)).toBeVisible();

  // --- the leaver deletes the account ---
  const dialog = await openDeleteDialog(page, leaver);
  await expect(dialog.getByRole('button', { name: 'Delete account' })).toBeDisabled();
  await dialog.getByLabel(/type .* to confirm/i).fill(leaver.username);
  await dialog.getByRole('button', { name: 'Delete account' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Your account has been deleted.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0);

  // --- everything of the leaver is gone: tables, notifications, the log and the picture file ---
  expect(leftOf(leaverId)).toBe(NOTHING);
  expect((await request.get(publicAvatarUrl(picture))).ok()).toBe(false);
  expect((await request.get(publicPostImageUrl(postPicture))).ok()).toBe(false);

  // --- but nothing of the friend ---
  expect(count(`select count(*) from profiles where id = '${friendId}';`)).toBe(1);
  expect(count(`select count(*) from posts where id = ${friendsPostId};`)).toBe(1);
  expect(count(`select count(*) from likes where post_id = ${friendsPostId};`)).toBe(0); // the leaver's like went
  expect(count(`select count(*) from comments where post_id = ${friendsPostId};`)).toBe(0);

  // --- the friend's open page follows without a reload, and the profile is gone ---
  await expect(postCard(friendPage, leaversPost)).toHaveCount(0);
  await expect(postCard(friendPage, friendsPost)).toBeVisible();
  await friendPage.goto(`/profile/${leaver.username}`);
  await expect(friendPage.getByRole('heading', { name: 'User not found.' })).toBeVisible();

  // --- the leaver cannot log in any more, and the name is free again ---
  await page.getByLabel(/^email/i).fill(leaver.email);
  await page.getByLabel(/^password/i).fill(leaver.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  // (the toast about the deleted account is an alert too, so look in the form)
  await expect(page.locator('form').getByRole('alert')).toContainText(/invalid login credentials/i);

  await friendContext.close();
});

test('an account with nothing in it can be deleted too', async ({ page }) => {
  const user = newUser('empty');
  await signUp(page, user);
  const id = idOf(user);

  const dialog = await openDeleteDialog(page, user);
  await dialog.getByLabel(/type .* to confirm/i).fill(user.username);
  await dialog.getByRole('button', { name: 'Delete account' }).click();

  await expect(page).toHaveURL(/\/login$/);
  expect(leftOf(id)).toBe(NOTHING);
});

test('the confirmation needs the exact username, and cancelling keeps everything', async ({ page }) => {
  const user = newUser('keep');
  await signUp(page, user);
  const id = idOf(user);

  const dialog = await openDeleteDialog(page, user);
  const confirm = dialog.getByRole('button', { name: 'Delete account' });
  const box = dialog.getByLabel(/type .* to confirm/i);

  await box.fill(user.username.slice(0, -1));
  await expect(confirm).toBeDisabled();
  await box.fill(user.username.toUpperCase());
  await expect(confirm).toBeDisabled();
  await box.fill('someone_else');
  await expect(confirm).toBeDisabled();

  await box.fill(user.username);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  expect(count(`select count(*) from profiles where id = '${id}';`)).toBe(1);
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
});

test('if the picture cannot be removed the account is not deleted', async ({ page, request }) => {
  const user = newUser('stuck');
  await signUp(page, user);
  const id = idOf(user);
  const api = await apiSessionOf(request, user, id);
  const picture = `${id}/${Date.now()}.png`;
  await uploadAvatar(request, api, picture);
  await patchProfile(request, api, { avatar_path: picture });

  // Storage "breaks" for the folder listing that the deletion starts with
  await page.route('**/storage/v1/object/list/avatars', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'storage down' }) })
  );
  const dialog = await openDeleteDialog(page, user);
  await dialog.getByLabel(/type .* to confirm/i).fill(user.username);
  await dialog.getByRole('button', { name: 'Delete account' }).click();

  await expect(dialog.getByRole('alert')).toContainText('Could not remove your pictures');
  expect(count(`select count(*) from profiles where id = '${id}';`)).toBe(1);
  expect((await request.get(publicAvatarUrl(picture))).ok()).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/profile/${user.username}$`));

  // When storage works again the same dialog finishes the job
  await page.unroute('**/storage/v1/object/list/avatars');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(leftOf(id)).toBe(NOTHING);
});

test('after the deletion the old login stops working, and the name and email can be used again', async ({ page }) => {
  const user = newUser('gone');
  await signUp(page, user);
  const dialog = await openDeleteDialog(page, user);
  await dialog.getByLabel(/type .* to confirm/i).fill(user.username);
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // The browser has forgotten the session: protected pages send the visitor to the login page
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0);

  // The same email and password do not work any more ...
  await page.getByLabel(/^email/i).fill(user.email);
  await page.getByLabel(/^password/i).fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText(/invalid login credentials/i);

  // ... but the username and email are free again: they can be used for a new account
  await signUp(page, user);
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  expect(count(`select count(*) from profiles where username = '${user.username}';`)).toBe(1);
});

test.describe('the database function', () => {
  test('deletes only the account of whoever calls it', async ({ request }) => {
    const caller = await createUser(request, 'delcaller');
    const bystander = await createUser(request, 'delother');

    const response = await request.post(`${API}/rest/v1/rpc/delete_my_account`, { headers: authHeaders(caller, json), data: {} });

    expect(response.ok()).toBe(true);
    expect(count(`select count(*) from auth.users where id = '${caller.id}';`)).toBe(0);
    expect(count(`select count(*) from auth.users where id = '${bystander.id}';`)).toBe(1);
  });

  test('cannot be called without logging in', async ({ request }) => {
    const bystander = await createUser(request, 'delvisitor');

    const response = await request.post(`${API}/rest/v1/rpc/delete_my_account`, {
      headers: { apikey: KEY, ...json },
      data: {},
    });

    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe('42501');
    expect(count(`select count(*) from auth.users where id = '${bystander.id}';`)).toBe(1);
  });

  test('accepts no id from the caller: whatever is sent, only the own account goes', async ({ request }) => {
    const caller = await createUser(request, 'delsneaky');
    const victim = await createUser(request, 'delvictim');

    await request.post(`${API}/rest/v1/rpc/delete_my_account`, {
      headers: authHeaders(caller, json),
      data: { id: victim.id, user_id: victim.id },
    });

    expect(count(`select count(*) from auth.users where id = '${victim.id}';`)).toBe(1);
  });
});
