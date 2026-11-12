import { test, expect } from '@playwright/test';
import { API, createUser, authHeaders, runSql } from './api';
import { newUser, signUp, createPost, postCard, listenToFrames, waitForSubscription } from './helpers';

// Blocking and reporting in the browser: the buttons, the questions, what the page shows and what
// ends up in the database. The rules of the database itself are in abuse.spec.js.

const json = { 'Content-Type': 'application/json', Prefer: 'return=representation' };
const tag = () => Math.random().toString(36).slice(2, 8);

async function apiPost(request, user, content) {
  const response = await request.post(`${API}/rest/v1/posts`, { headers: authHeaders(user, json), data: { user_id: user.id, content } });
  expect(response.ok()).toBe(true);
  return (await response.json())[0];
}

async function apiComment(request, user, postId, content) {
  const response = await request.post(`${API}/rest/v1/comments`, { headers: authHeaders(user, json), data: { post_id: postId, user_id: user.id, content } });
  expect(response.ok()).toBe(true);
}

const blockButton = (page) => page.getByRole('button', { name: 'Block', exact: true });

// Reports, as the owner of the app would read them: "reason|details|copy of the text|who reported|who is reported|post|comment"
function reportsBy(username) {
  return runSql(`
    select r.reason, coalesce(r.details, ''), coalesce(r.content_snapshot, ''), rp.username, ru.username,
           coalesce(r.post_id::text, ''), coalesce(r.comment_id::text, '')
    from reports r
    join profiles rp on rp.id = r.reporter_id
    join profiles ru on ru.id = r.reported_user_id
    where rp.username = '${username}' order by r.id;
  `).trim().split('\n').filter(Boolean).map((line) => line.split('|'));
}

async function sendReport(page, { title, reason, details }) {
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: reason }).check();
  if (details) await dialog.getByRole('textbox', { name: 'Details (optional)' }).fill(details);
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe('blocking', () => {
  test('from a profile: a question first, then the page says so and hides the person, and unblocking brings them back', async ({ page, request }) => {
    const me = newUser('blocker');
    await signUp(page, me);
    const other = await createUser(request, 'target');
    const text = `from the target ${tag()}`;
    await apiPost(request, other, text);
    await page.goto('/');
    await expect(postCard(page, text)).toBeVisible();

    await page.goto(`/profile/${other.username}`);
    await expect(page.getByText(text)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Report user' })).toBeVisible();

    // Cancelling the question blocks nobody
    await blockButton(page).click();
    const dialog = page.getByRole('dialog', { name: `Block @${other.username}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();

    // Confirming does
    await blockButton(page).click();
    await dialog.getByRole('button', { name: 'Block', exact: true }).click();
    await expect(page.getByText(`Blocked @${other.username}.`)).toBeVisible();
    await expect(page.getByText(`You have blocked @${other.username}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unblock' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Report user' })).toHaveCount(0);
    await expect(page.getByText(text)).toHaveCount(0);

    // It is the same after a reload, and the person is gone from the home feed too
    await page.reload();
    await expect(page.getByRole('button', { name: 'Unblock' })).toBeVisible();
    await expect(page.getByText(text)).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByPlaceholder("What's on your mind?")).toBeVisible();
    await expect(page.getByText(text)).toHaveCount(0);

    // Unblocking: everything is back
    await page.goto(`/profile/${other.username}`);
    await page.getByRole('button', { name: 'Unblock' }).click();
    await expect(page.getByText(`Unblocked @${other.username}.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
    await expect(page.getByText(text)).toBeVisible();
    await page.goto('/');
    await expect(postCard(page, text)).toBeVisible();
  });

  test('the follows end, and the blocked person is refused by the page with a short message', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const a = await contextA.newPage();
    const b = await contextB.newPage();
    const userA = newUser('blocker');
    const userB = newUser('blocked');
    await signUp(a, userA);
    await signUp(b, userB);
    const postText = `post of the blocker ${tag()}`;
    await createPost(a, postText);

    // They follow each other
    await a.goto(`/profile/${userB.username}`);
    await a.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Unfollow' })).toBeVisible();
    await b.goto(`/profile/${userA.username}`);
    await b.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(b.getByText('1 followers')).toBeVisible();

    // A blocks B
    await blockButton(a).click();
    await a.getByRole('dialog').getByRole('button', { name: 'Block', exact: true }).click();
    await expect(a.getByText(`You have blocked @${userB.username}`)).toBeVisible();
    await expect(a.getByText('0 followers')).toBeVisible();
    await expect(a.getByText('0 following')).toBeVisible();

    // B sees that the follow is gone, can still see A, and is refused when trying to follow, like or comment
    await b.reload();
    await expect(b.getByText('0 followers')).toBeVisible();
    await expect(b.getByText(postText)).toBeVisible();
    await b.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(b.getByText('Could not follow user: You cannot do that.')).toBeVisible();
    await expect(b.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();

    const card = postCard(b, postText);
    await card.getByRole('button', { name: 'Like post' }).click();
    await expect(b.getByText('Could not update like: You cannot do that.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Like post' })).toBeVisible();

    await card.getByRole('button', { name: 'Show comments' }).click();
    await card.getByLabel('Write a comment').fill('can I?');
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(b.getByText('Could not add comment: You cannot do that.')).toBeVisible();
    await expect(card.getByText('can I?')).toHaveCount(0);

    // Nothing of it reached A
    await a.goto('/notifications');
    await expect(a.getByText('No notifications yet.')).toBeVisible();
  });

  test('the blocker is not sent the new posts and comments of the blocked person, but still those of others', async ({ page, request }) => {
    const me = newUser('watcher');
    await signUp(page, me);
    const blocked = await createUser(request, 'muted');
    const third = await createUser(request, 'friend');
    runSql(`
      insert into blocks (blocker_id, blocked_id)
      select a.id, b.id from profiles a, profiles b where a.username = '${me.username}' and b.username = '${blocked.username}';
    `);
    const frames = listenToFrames(page);
    await page.goto('/');
    await waitForSubscription(page, frames, 'feed-1');

    // The blocked person writes first, then somebody else: when the second one is there the first would be too
    const hidden = `from the muted ${tag()}`;
    const shown = `from the friend ${tag()}`;
    await apiPost(request, blocked, hidden);
    const thirdPost = await apiPost(request, third, shown);
    await expect(postCard(page, shown)).toBeVisible();
    await expect(page.getByText(hidden)).toHaveCount(0);

    // The same under a post that is open: the comment of the blocked person does not arrive
    await postCard(page, shown).getByRole('button', { name: 'Show comments' }).click();
    await waitForSubscription(page, frames, 'comments-');
    await apiComment(request, blocked, thirdPost.id, `comment of the muted ${tag()}`);
    const visibleComment = `comment of the friend ${tag()}`;
    await apiComment(request, third, thirdPost.id, visibleComment);
    await expect(page.getByText(visibleComment)).toBeVisible();
    await expect(page.getByText(/comment of the muted/)).toHaveCount(0);
  });
});

test.describe('reporting', () => {
  test('a post, a comment and a person can be reported: the owner finds who, what, why and a copy of the text', async ({ page, request }) => {
    const me = newUser('reporter');
    await signUp(page, me);
    const other = await createUser(request, 'offender');
    const postText = `a rude post ${tag()}`;
    const commentText = `a rude comment ${tag()}`;
    const made = await apiPost(request, other, postText);
    await apiComment(request, other, made.id, commentText);
    await page.goto('/');
    const card = postCard(page, postText);
    await expect(card).toBeVisible();

    // The post. The button stays disabled until a reason is chosen.
    await card.getByRole('button', { name: 'Report post' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report this post' });
    await expect(dialog.getByRole('button', { name: 'Send report' })).toBeDisabled();
    await sendReport(page, { title: 'Report this post', reason: 'Spam', details: 'selling things' });
    await expect(page.getByText('Thank you. Your report was sent.')).toBeVisible();

    // The same post again
    await card.getByRole('button', { name: 'Report post' }).click();
    await sendReport(page, { title: 'Report this post', reason: 'Hate speech' });
    await expect(page.getByText('You have already reported this.')).toBeVisible();

    // The comment
    await card.getByRole('button', { name: 'Show comments' }).click();
    await card.getByRole('button', { name: 'Report comment' }).click();
    await sendReport(page, { title: 'Report this comment', reason: 'Harassment or bullying' });

    // The person
    await page.goto(`/profile/${other.username}`);
    await page.getByRole('button', { name: 'Report user' }).click();
    await sendReport(page, { title: `Report @${other.username}`, reason: 'Violence or threats', details: 'threatened me' });

    await expect.poll(() => reportsBy(me.username).length).toBe(3);
    const [onPost, onComment, onPerson] = reportsBy(me.username);
    expect(onPost.slice(0, 5)).toEqual(['spam', 'selling things', postText, me.username, other.username]);
    expect(onPost[5]).toBe(String(made.id));
    expect(onComment.slice(0, 5)).toEqual(['harassment', '', commentText, me.username, other.username]);
    expect(onComment[6]).not.toBe('');
    expect(onPerson).toEqual(['violence', 'threatened me', '', me.username, other.username, '', '']);
  });

  test('your own posts and comments have no Report button, and a report that is cancelled is not sent', async ({ page, request }) => {
    const me = newUser('careful');
    await signUp(page, me);
    const own = `my own post ${tag()}`;
    await createPost(page, own);
    await postCard(page, own).getByRole('button', { name: 'Show comments' }).click();
    await postCard(page, own).getByLabel('Write a comment').fill('my own comment');
    await postCard(page, own).getByRole('button', { name: 'Send' }).click();
    await expect(postCard(page, own).getByText('my own comment')).toBeVisible();
    await expect(postCard(page, own).getByRole('button', { name: 'Report post' })).toHaveCount(0);
    await expect(postCard(page, own).getByRole('button', { name: 'Report comment' })).toHaveCount(0);
    await page.goto(`/profile/${me.username}`);
    await expect(page.getByRole('button', { name: 'Report user' })).toHaveCount(0);
    await expect(blockButton(page)).toHaveCount(0);

    const other = await createUser(request, 'bystander');
    const text = `a post to leave alone ${tag()}`;
    await apiPost(request, other, text);
    await page.goto('/');
    await postCard(page, text).getByRole('button', { name: 'Report post' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report this post' });
    await dialog.getByRole('radio', { name: 'Spam' }).check();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(reportsBy(me.username)).toEqual([]);
  });
});
