import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { API, createUser, authHeaders, runSql } from './api';
import { newUser, signUp, createPost, postCard } from './helpers';

// A page should only be sent the realtime changes it shows. These tests read the messages that
// really arrive in the browser (the WebSocket frames) and check which posts they are about.
//
// The "other person" does everything through the API. Every like is kept for a moment before it is
// taken back: Realtime checks a change after it has happened, and a like that is gone by then is
// not reported at all, which would make "nothing arrived" true for the wrong reason.

const tag = () => randomBytes(3).toString('hex');
const json = { 'Content-Type': 'application/json', Prefer: 'return=minimal' };
const pause = (page, ms = 800) => page.waitForTimeout(ms);

// Collects every frame the page receives over its realtime connections
function listenToFrames(page) {
  const frames = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => frames.push(String(frame.payload)));
  });
  return frames;
}

// The ids of the posts that changes of `table` in the frames are about
function postsReportedIn(frames, table) {
  const ids = new Set();
  for (const frame of frames) {
    if (!frame.includes(`"table":"${table}"`)) continue;
    // (the server writes a space after the colon: "post_id": 65)
    for (const match of frame.matchAll(/"post_id":\s*(\d+)/g)) ids.add(Number(match[1]));
  }
  return ids;
}

const like = (request, who, postId) =>
  request.post(`${API}/rest/v1/likes`, { headers: authHeaders(who, json), data: { post_id: postId, user_id: who.id } });
const unlike = (request, who, postId) =>
  request.delete(`${API}/rest/v1/likes?post_id=eq.${postId}&user_id=eq.${who.id}`, { headers: authHeaders(who) });
const comment = (request, who, postId, text) =>
  request.post(`${API}/rest/v1/comments`, { headers: authHeaders(who, json), data: { post_id: postId, user_id: who.id, content: text } });

// Writes posts straight into the database (fast, and no rate limit). Returns their ids, oldest first
function writePosts(authorId, label, count) {
  return runSql(`
    set session_replication_role = replica;
    insert into posts (user_id, content)
      select '${authorId}', '${label} ' || g from generate_series(1, ${count}) g;
    select id from posts where content like '${label} %' order by id;
  `).split('\n').map((line) => line.trim()).filter(Boolean).map(Number).slice(-count);
}

// The subscription of a page is opened a moment after the posts have arrived, and Realtime needs a
// moment to start it. Until it works, a like is not reported. So: like again and again until the
// page shows it.
async function untilPageShowsLike(page, request, who, postId, card) {
  await expect(async () => {
    await unlike(request, who, postId);
    await pause(page, 300);
    await like(request, who, postId);
    await expect(card.getByText('1', { exact: true })).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 25_000 });
}

test.describe('the home page feed', () => {
  test('is sent the likes and comments of the posts it shows, and none of the others', async ({ page, request }) => {
    const frames = listenToFrames(page);
    const author = await createUser(request, 'rtauthor');
    const other = await createUser(request, 'rtother');
    await signUp(page, newUser('rtview'));

    // One old post, and 25 newer ones: the home page shows the newest 20 only
    const label = `rt-feed-${tag()}`;
    const [oldPost, ...newer] = writePosts(author.id, label, 26);
    const shown = newer.at(-1);
    await page.goto('/');
    const shownCard = postCard(page, `${label} 26`);
    await expect(shownCard).toBeVisible();
    await expect(page.getByText(`${label} 1`, { exact: true })).toHaveCount(0); // the old post is not on the page

    await untilPageShowsLike(page, request, other, shown, shownCard);

    // Now the real check: activity on the old post, then something on the post that is shown
    frames.length = 0;
    await like(request, other, oldPost);
    await comment(request, other, oldPost, 'a comment nobody on this page needs');
    await pause(page);
    await unlike(request, other, oldPost);
    await unlike(request, other, shown);
    await expect(shownCard.getByText('0', { exact: true })).toHaveCount(2); // likes and comments are 0 again
    await comment(request, other, shown, 'a comment on a post that is shown');
    await expect(shownCard.getByText('1', { exact: true })).toBeVisible();

    expect(postsReportedIn(frames, 'likes')).toEqual(new Set([shown]));
    expect(postsReportedIn(frames, 'comments')).toEqual(new Set([shown]));
  });

  test('shows a like that is taken back (the unlike is reported too)', async ({ page, request }) => {
    const author = await createUser(request, 'rtauthor');
    const other = await createUser(request, 'rtother');
    await signUp(page, newUser('rtunlike'));
    const label = `rt-unlike-${tag()}`;
    const [postId] = writePosts(author.id, label, 1);
    await page.goto('/');
    const card = postCard(page, `${label} 1`);
    await expect(card).toBeVisible();

    await untilPageShowsLike(page, request, other, postId, card);
    await pause(page);
    await unlike(request, other, postId);

    await expect(card.getByText('1', { exact: true })).toHaveCount(0);
  });

  test('gets the likes of a post you have just written, because the subscription follows the list', async ({ page, request }) => {
    const other = await createUser(request, 'rtother');
    await signUp(page, newUser('rtown'));
    const text = `rt-own-${tag()}`;
    await createPost(page, text);
    const postId = Number(runSql(`select id from posts where content = '${text}';`).trim());

    await untilPageShowsLike(page, request, other, postId, postCard(page, text));
  });
});

test.describe('the page of one post', () => {
  test('is sent the changes of this post only', async ({ page, request }) => {
    const frames = listenToFrames(page);
    const author = await createUser(request, 'rtauthor');
    const other = await createUser(request, 'rtother');
    await signUp(page, newUser('rtpost'));
    const [thisPost, otherPost] = writePosts(author.id, `rt-page-${tag()}`, 2);
    await page.goto(`/post/${thisPost}`);
    const card = page.locator('.MuiCard-root').first();
    await expect(card).toBeVisible();

    await untilPageShowsLike(page, request, other, thisPost, card);

    frames.length = 0;
    await like(request, other, otherPost);
    await comment(request, other, otherPost, 'a comment on another post');
    await pause(page);
    await unlike(request, other, otherPost);
    await comment(request, other, thisPost, 'a comment on this post');
    await expect(page.getByText('a comment on this post')).toBeVisible();

    expect(postsReportedIn(frames, 'likes')).not.toContain(otherPost);
    expect(postsReportedIn(frames, 'comments')).toEqual(new Set([thisPost]));
  });
});

test.describe('the page of a user', () => {
  test('is sent the new posts of that user only', async ({ page, request }) => {
    const frames = listenToFrames(page);
    const author = await createUser(request, 'rtprof');
    const stranger = await createUser(request, 'rtstr');
    await signUp(page, newUser('rtprofview'));
    await page.goto(`/profile/${author.username}`);
    await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();

    const write = (who, text) =>
      request.post(`${API}/rest/v1/posts`, { headers: authHeaders(who, json), data: { user_id: who.id, content: text } });

    // Until the subscription works, a new post of the author is not reported: write until it shows
    const probe = `rt-probe-${tag()}`;
    await expect(async () => {
      await write(author, probe);
      await expect(postCard(page, probe).first()).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 25_000 });

    frames.length = 0;
    const strangersText = `rt-stranger-${tag()}`;
    const authorsText = `rt-author-${tag()}`;
    await write(stranger, strangersText);
    await write(author, authorsText);
    await expect(postCard(page, authorsText)).toBeVisible();

    const received = frames.join('\n');
    expect(received).toContain(authorsText);
    expect(received).not.toContain(strangersText);
    expect(await page.getByText(strangersText).count()).toBe(0);
  });
});
