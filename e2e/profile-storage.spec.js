import { test, expect } from '@playwright/test';
import {
  API, KEY, TINY_PNG, createUser, authHeaders, uploadAvatar, publicAvatarUrl, patchProfile,
} from './api';

// These tests call the API directly to prove that the database and the storage service
// enforce the rules, no matter what the web app does.

test.describe('avatar storage', () => {
  test('a user can upload an avatar to their own folder and anyone can view it', async ({ request }) => {
    const user = await createUser(request);
    const path = `${user.id}/avatar.png`;

    const upload = await uploadAvatar(request, user, path);
    expect(upload.ok()).toBe(true);

    // No login needed to view a public avatar
    const view = await request.get(publicAvatarUrl(path));
    expect(view.status()).toBe(200);
    expect(view.headers()['content-type']).toContain('image/png');
  });

  test('a user cannot upload into another user\'s folder', async ({ request }) => {
    const owner = await createUser(request, 'owner');
    const intruder = await createUser(request, 'intruder');
    const path = `${owner.id}/hijack.png`;

    const upload = await uploadAvatar(request, intruder, path);
    expect(upload.ok()).toBe(false);

    const view = await request.get(publicAvatarUrl(path));
    expect(view.status()).toBe(400); // nothing was stored (storage answers "not found" with 400)
  });

  test('a logged-out visitor cannot upload', async ({ request }) => {
    const user = await createUser(request);
    const response = await request.post(`${API}/storage/v1/object/avatars/${user.id}/anon.png`, {
      headers: { apikey: KEY, 'Content-Type': 'image/png' },
      data: TINY_PNG,
    });
    expect(response.ok()).toBe(false);
  });

  test('files that are not images are rejected', async ({ request }) => {
    const user = await createUser(request);
    const upload = await uploadAvatar(request, user, `${user.id}/notes.txt`, {
      body: Buffer.from('just some text'),
      contentType: 'text/plain',
    });
    expect(upload.ok()).toBe(false);
    expect((await upload.json()).code).toBe('InvalidMimeType');
  });

  test('files larger than 2 MB are rejected', async ({ request }) => {
    const user = await createUser(request);
    const upload = await uploadAvatar(request, user, `${user.id}/huge.png`, {
      body: Buffer.alloc(2 * 1024 * 1024 + 1024, 1),
    });
    expect(upload.ok()).toBe(false);
    // The storage service answers HTTP 400 and puts the real reason in the body
    expect((await upload.json()).code).toBe('EntityTooLarge');
  });

  test('a user can delete their own avatar but not someone else\'s', async ({ request }) => {
    const owner = await createUser(request, 'owner');
    const other = await createUser(request, 'other');
    const path = `${owner.id}/keep.png`;
    expect((await uploadAvatar(request, owner, path)).ok()).toBe(true);

    // The other user's delete does not remove the file
    await request.delete(`${API}/storage/v1/object/avatars/${path}`, { headers: authHeaders(other) });
    expect((await request.get(publicAvatarUrl(path))).status()).toBe(200);

    // The owner's delete does
    const del = await request.delete(`${API}/storage/v1/object/avatars/${path}`, { headers: authHeaders(owner) });
    expect(del.ok()).toBe(true);
    expect((await request.get(publicAvatarUrl(path))).ok()).toBe(false);
  });
});

test.describe('profile fields', () => {
  test('a user can edit display name, bio and avatar path', async ({ request }) => {
    const user = await createUser(request);
    const response = await patchProfile(request, user, {
      display_name: 'Test Person',
      bio: 'Hello, I like testing.',
      avatar_path: `${user.id}/me.png`,
    });

    expect(response.ok()).toBe(true);
    const [profile] = await response.json();
    expect(profile).toMatchObject({
      display_name: 'Test Person',
      bio: 'Hello, I like testing.',
      avatar_path: `${user.id}/me.png`,
    });
  });

  test('the display name is limited to 50 characters', async ({ request }) => {
    const user = await createUser(request);

    expect((await patchProfile(request, user, { display_name: 'a'.repeat(50) })).ok()).toBe(true);

    const tooLong = await patchProfile(request, user, { display_name: 'a'.repeat(51) });
    expect(tooLong.status()).toBe(400);
    expect((await tooLong.json()).code).toBe('23514');
  });

  test('the bio is limited to 160 characters', async ({ request }) => {
    const user = await createUser(request);

    expect((await patchProfile(request, user, { bio: 'b'.repeat(160) })).ok()).toBe(true);

    const tooLong = await patchProfile(request, user, { bio: 'b'.repeat(161) });
    expect(tooLong.status()).toBe(400);
    expect((await tooLong.json()).code).toBe('23514');
  });

  test('the avatar path must point into the user\'s own folder', async ({ request }) => {
    const user = await createUser(request, 'me');
    const other = await createUser(request, 'other');

    const stolen = await patchProfile(request, user, { avatar_path: `${other.id}/their.png` });
    expect(stolen.status()).toBe(400);
    expect((await stolen.json()).code).toBe('23514');

    const loose = await patchProfile(request, user, { avatar_path: 'somewhere/else.png' });
    expect(loose.status()).toBe(400);

    // Removing the avatar is allowed
    expect((await patchProfile(request, user, { avatar_path: null })).ok()).toBe(true);
  });

  test('a user cannot edit someone else\'s profile', async ({ request }) => {
    const owner = await createUser(request, 'owner');
    const intruder = await createUser(request, 'intruder');

    const response = await request.patch(`${API}/rest/v1/profiles?id=eq.${owner.id}`, {
      headers: authHeaders(intruder, { Prefer: 'return=representation' }),
      data: { bio: 'hacked' },
    });

    // RLS hides the row, so nothing is updated
    expect(await response.json()).toEqual([]);
  });

  test('the feed view includes the author\'s avatar path', async ({ request }) => {
    const user = await createUser(request, 'feed');
    const avatar = `${user.id}/feed.png`;
    await patchProfile(request, user, { avatar_path: avatar });
    await request.post(`${API}/rest/v1/posts`, {
      headers: authHeaders(user, { Prefer: 'return=minimal' }),
      data: { user_id: user.id, content: `post with avatar ${user.username}` },
    });

    const feed = await request.get(`${API}/rest/v1/posts_feed?user_id=eq.${user.id}&select=username,avatar_path`, {
      headers: authHeaders(user),
    });
    expect(await feed.json()).toEqual([{ username: user.username, avatar_path: avatar }]);
  });
});
