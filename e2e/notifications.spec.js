import { test, expect } from '@playwright/test';
import { API, createUser, authHeaders } from './api';
import { newUser, signUp, createPost, postCard, bell } from './helpers';

// ---- Small API helpers: act as a user, the same way the app does ----

const json = { 'Content-Type': 'application/json', Prefer: 'return=representation' };

async function addPost(request, user, content = `post ${user.username}`) {
  const response = await request.post(`${API}/rest/v1/posts`, {
    headers: authHeaders(user, json),
    data: { user_id: user.id, content },
  });
  return (await response.json())[0].id;
}

const like = (request, user, postId) =>
  request.post(`${API}/rest/v1/likes`, { headers: authHeaders(user, json), data: { post_id: postId, user_id: user.id } });

const unlike = (request, user, postId) =>
  request.delete(`${API}/rest/v1/likes?post_id=eq.${postId}&user_id=eq.${user.id}`, { headers: authHeaders(user) });

const follow = (request, user, targetId) =>
  request.post(`${API}/rest/v1/follows`, { headers: authHeaders(user, json), data: { follower_id: user.id, following_id: targetId } });

const unfollow = (request, user, targetId) =>
  request.delete(`${API}/rest/v1/follows?follower_id=eq.${user.id}&following_id=eq.${targetId}`, { headers: authHeaders(user) });

const comment = (request, user, postId, content) =>
  request.post(`${API}/rest/v1/comments`, { headers: authHeaders(user, json), data: { post_id: postId, user_id: user.id, content } });

async function inbox(request, user) {
  const response = await request.get(`${API}/rest/v1/notifications?select=id,type,post_id,actor_id,read&order=id.asc`, {
    headers: authHeaders(user),
  });
  return response.json();
}

const ofType = (notifications, type) => notifications.filter((n) => n.type === type);

test.describe('notifications are not duplicated', () => {
  test('liking, unliking and liking again gives one notification', async ({ request }) => {
    const owner = await createUser(request, 'owner');
    const fan = await createUser(request, 'fan');
    const postId = await addPost(request, owner);

    await like(request, fan, postId);
    await unlike(request, fan, postId);
    await like(request, fan, postId);
    await unlike(request, fan, postId);
    await like(request, fan, postId);

    const likes = ofType(await inbox(request, owner), 'like');
    expect(likes).toHaveLength(1);
    expect(likes[0]).toMatchObject({ post_id: postId, actor_id: fan.id });
  });

  test('following, unfollowing and following again gives one notification', async ({ request }) => {
    const star = await createUser(request, 'star');
    const fan = await createUser(request, 'fan');

    await follow(request, fan, star.id);
    await unfollow(request, fan, star.id);
    await follow(request, fan, star.id);

    const follows = ofType(await inbox(request, star), 'follow');
    expect(follows).toHaveLength(1);
    expect(follows[0].actor_id).toBe(fan.id);
  });

  test('the same person liking two different posts gives two notifications', async ({ request }) => {
    const owner = await createUser(request, 'owner');
    const fan = await createUser(request, 'fan');
    const first = await addPost(request, owner, 'first');
    const second = await addPost(request, owner, 'second');

    await like(request, fan, first);
    await like(request, fan, second);

    const likes = ofType(await inbox(request, owner), 'like');
    expect(likes.map((n) => n.post_id).sort()).toEqual([first, second].sort());
  });

  test('two different people liking the same post give two notifications', async ({ request }) => {
    const owner = await createUser(request, 'owner');
    const fan1 = await createUser(request, 'fan');
    const fan2 = await createUser(request, 'fan');
    const postId = await addPost(request, owner);

    await like(request, fan1, postId);
    await like(request, fan2, postId);

    const likes = ofType(await inbox(request, owner), 'like');
    expect(likes.map((n) => n.actor_id).sort()).toEqual([fan1.id, fan2.id].sort());
  });

  test('every comment still gets its own notification', async ({ request }) => {
    const owner = await createUser(request, 'owner');
    const talker = await createUser(request, 'talker');
    const postId = await addPost(request, owner);

    await comment(request, talker, postId, 'first comment');
    await comment(request, talker, postId, 'second comment');

    expect(ofType(await inbox(request, owner), 'comment')).toHaveLength(2);
  });

  test('a notification that was already read does not become unread again', async ({ request }) => {
    const owner = await createUser(request, 'owner');
    const fan = await createUser(request, 'fan');
    const postId = await addPost(request, owner);

    await like(request, fan, postId);
    await request.patch(`${API}/rest/v1/notifications?user_id=eq.${owner.id}`, {
      headers: authHeaders(owner, json),
      data: { read: true },
    });

    await unlike(request, fan, postId);
    await like(request, fan, postId);

    const likes = ofType(await inbox(request, owner), 'like');
    expect(likes).toHaveLength(1);
    expect(likes[0].read).toBe(true);
  });

  test('liking or following yourself still gives no notification', async ({ request }) => {
    const user = await createUser(request, 'self');
    const postId = await addPost(request, user);

    await like(request, user, postId);
    await comment(request, user, postId, 'talking to myself');

    expect(await inbox(request, user)).toEqual([]);
  });

  test('users cannot create notifications themselves', async ({ request }) => {
    const victim = await createUser(request, 'victim');
    const attacker = await createUser(request, 'attacker');

    const response = await request.post(`${API}/rest/v1/notifications`, {
      headers: authHeaders(attacker, json),
      data: { user_id: victim.id, actor_id: attacker.id, type: 'follow' },
    });

    expect(response.ok()).toBe(false);
    expect(await inbox(request, victim)).toEqual([]);
  });
});

test.describe('notifications in the app', () => {
  test('toggling a like several times shows one unread notification', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const a = await contextA.newPage();
    const b = await contextB.newPage();
    const userA = newUser('owner');
    const userB = newUser('fan');
    await signUp(a, userA);
    await signUp(b, userB);

    const text = `Toggle me ${userA.username}`;
    await createPost(a, text);
    const card = postCard(b, text);
    await expect(card).toBeVisible();

    // Like, unlike, like, unlike, like
    for (const [from, to] of [
      ['Like post', 'Unlike post'],
      ['Unlike post', 'Like post'],
      ['Like post', 'Unlike post'],
      ['Unlike post', 'Like post'],
      ['Like post', 'Unlike post'],
    ]) {
      await card.getByRole('button', { name: from }).click();
      await expect(card.getByRole('button', { name: to })).toBeVisible();
    }

    await expect(bell(a)).toHaveAttribute('aria-label', 'Notifications, 1 unread');

    await bell(a).click();
    await expect(a.getByRole('link', { name: new RegExp(`@${userB.username} liked your post`) })).toHaveCount(1);
    await expect(bell(a)).toHaveAttribute('aria-label', 'Notifications');

    await contextA.close();
    await contextB.close();
  });
});
