import { test, expect } from '@playwright/test';
import {
  API, KEY, TINY_PNG, createUser, authHeaders, uploadPostImage, publicPostImageUrl, uploadAvatar, runSql,
} from './api';

// Pictures in posts, at the level of the storage service and the database: who may put a file
// where, which files are accepted, and what a post may point at.
// (Choosing a picture and seeing it in the browser: post-images-ui.spec.js.)

const json = { 'Content-Type': 'application/json', Prefer: 'return=representation' };

const addPost = (request, user, data) =>
  request.post(`${API}/rest/v1/posts`, { headers: authHeaders(user, json), data: { user_id: user.id, content: 'a post', ...data } });

test.describe('the storage of post pictures', () => {
  test('an author can add a picture to their own folder, and anybody can view it', async ({ request }) => {
    const author = await createUser(request, 'pimg');
    const path = `${author.id}/first.png`;

    const upload = await uploadPostImage(request, author, path);
    expect(upload.ok()).toBe(true);

    // No login is needed to view a public picture
    const view = await request.get(publicPostImageUrl(path));
    expect(view.status()).toBe(200);
    expect(view.headers()['content-type']).toContain('image/png');
  });

  test('nobody can put a file into the folder of somebody else', async ({ request }) => {
    const owner = await createUser(request, 'pimgown');
    const intruder = await createUser(request, 'pimgint');
    const path = `${owner.id}/hijack.png`;

    const upload = await uploadPostImage(request, intruder, path);

    expect(upload.ok()).toBe(false);
    expect((await request.get(publicPostImageUrl(path))).ok()).toBe(false);
  });

  test('a visitor who is not logged in cannot add a picture', async ({ request }) => {
    const author = await createUser(request, 'pimgvis');

    const response = await request.post(`${API}/storage/v1/object/post-images/${author.id}/anon.png`, {
      headers: { apikey: KEY, 'Content-Type': 'image/png' },
      data: TINY_PNG,
    });

    expect(response.ok()).toBe(false);
  });

  test('only JPEG, PNG and WebP are accepted', async ({ request }) => {
    const author = await createUser(request, 'pimgtype');

    for (const [name, contentType] of [['notes.txt', 'text/plain'], ['drawing.svg', 'image/svg+xml'], ['funny.gif', 'image/gif'], ['paper.pdf', 'application/pdf']]) {
      const upload = await uploadPostImage(request, author, `${author.id}/${name}`, { body: Buffer.from('not a real picture'), contentType });
      expect(upload.ok(), `${contentType} must be refused`).toBe(false);
      expect((await upload.json()).code).toBe('InvalidMimeType');
    }
    for (const [name, contentType] of [['a.jpg', 'image/jpeg'], ['b.webp', 'image/webp']]) {
      const upload = await uploadPostImage(request, author, `${author.id}/${name}`, { contentType });
      expect(upload.ok(), `${contentType} must be accepted`).toBe(true);
    }
  });

  test('a picture of 5 MB is accepted and one byte more is not', async ({ request }) => {
    const author = await createUser(request, 'pimgsize');
    const FIVE_MB = 5 * 1024 * 1024;

    const fits = await uploadPostImage(request, author, `${author.id}/fits.png`, { body: Buffer.alloc(FIVE_MB, 1) });
    expect(fits.ok()).toBe(true);

    const tooBig = await uploadPostImage(request, author, `${author.id}/big.png`, { body: Buffer.alloc(FIVE_MB + 1, 1) });
    expect(tooBig.ok()).toBe(false);
    expect(JSON.stringify(await tooBig.json())).toMatch(/exceeded the maximum allowed size|too large|EntityTooLarge/i);
  });

  test('the author can remove a picture, and nobody else can', async ({ request }) => {
    const author = await createUser(request, 'pimgdel');
    const other = await createUser(request, 'pimgdelo');
    const path = `${author.id}/remove-me.png`;
    await uploadPostImage(request, author, path);

    await request.delete(`${API}/storage/v1/object/post-images/${path}`, { headers: authHeaders(other) });
    expect((await request.get(publicPostImageUrl(path))).ok(), 'still there after the attempt of somebody else').toBe(true);

    const byAuthor = await request.delete(`${API}/storage/v1/object/post-images/${path}`, { headers: authHeaders(author) });
    expect(byAuthor.ok()).toBe(true);
    expect((await request.get(publicPostImageUrl(path))).ok()).toBe(false);
  });

  test('a picture can not be replaced in place: there is no update, only a new file', async ({ request }) => {
    const author = await createUser(request, 'pimgupd');
    const path = `${author.id}/fixed.png`;
    await uploadPostImage(request, author, path);

    const again = await request.put(`${API}/storage/v1/object/post-images/${path}`, {
      headers: authHeaders(author, { 'Content-Type': 'image/png' }),
      data: Buffer.concat([TINY_PNG, Buffer.from('x')]),
    });

    expect(again.ok()).toBe(false);
  });

  test('the avatar bucket and the post bucket are separate: a file in one is not in the other', async ({ request }) => {
    const author = await createUser(request, 'pimgsep');
    await uploadAvatar(request, author, `${author.id}/only-avatar.png`);

    expect((await request.get(publicPostImageUrl(`${author.id}/only-avatar.png`))).ok()).toBe(false);
  });
});

test.describe('a post with a picture', () => {
  test('is saved with the place of the picture and shows it in the feed views', async ({ request }) => {
    const author = await createUser(request, 'ppic');
    const reader = await createUser(request, 'ppicrd');
    const path = `${author.id}/photo.png`;
    await uploadPostImage(request, author, path);
    await request.post(`${API}/rest/v1/follows`, { headers: authHeaders(reader, json), data: { follower_id: reader.id, following_id: author.id } });

    const created = await addPost(request, author, { image_path: path });

    expect(created.status()).toBe(201);
    const [post] = await created.json();
    expect(post.image_path).toBe(path);
    const all = (await (await request.get(`${API}/rest/v1/posts_feed?id=eq.${post.id}`, { headers: authHeaders(reader) })).json())[0];
    const following = (await (await request.get(`${API}/rest/v1/posts_following_feed?id=eq.${post.id}`, { headers: authHeaders(reader) })).json())[0];
    expect(all.image_path).toBe(path);
    expect(following.image_path).toBe(path);
  });

  test('a post without a picture has no place for one', async ({ request }) => {
    const author = await createUser(request, 'ppicno');

    const [post] = await (await addPost(request, author, {})).json();

    expect(post.image_path).toBeNull();
  });

  test('cannot point at a file in the folder of somebody else', async ({ request }) => {
    const author = await createUser(request, 'ppicown');
    const other = await createUser(request, 'ppicoth');

    const response = await addPost(request, author, { image_path: `${other.id}/their-photo.png` });

    expect(response.status()).toBe(400);
    expect((await response.json()).code).toBe('23514'); // check_violation
  });

  test('cannot point at a path that is no file of the author, like "../" tricks or an empty folder name', async ({ request }) => {
    const author = await createUser(request, 'ppicodd');

    for (const image_path of ['elsewhere/photo.png', 'photo.png', '', `${author.id}`]) {
      const response = await addPost(request, author, { image_path });
      expect(response.status(), JSON.stringify(image_path)).toBe(400);
    }
  });

  test('the picture of a post cannot be changed afterwards, only the text', async ({ request }) => {
    const author = await createUser(request, 'ppicchg');
    const path = `${author.id}/one.png`;
    await uploadPostImage(request, author, path);
    const [post] = await (await addPost(request, author, { image_path: path })).json();

    const swap = await request.patch(`${API}/rest/v1/posts?id=eq.${post.id}`, {
      headers: authHeaders(author, json),
      data: { image_path: null },
    });
    expect(swap.status()).toBe(403);
    expect((await swap.json()).code).toBe('42501');

    const edit = await request.patch(`${API}/rest/v1/posts?id=eq.${post.id}`, {
      headers: authHeaders(author, json),
      data: { content: 'a new text' },
    });
    expect(edit.status()).toBe(200);
    expect((await edit.json())[0].image_path).toBe(path);
  });

  test('deleting the post leaves the file to the app: the database cannot remove files', async ({ request }) => {
    const author = await createUser(request, 'ppicdel');
    const path = `${author.id}/stays.png`;
    await uploadPostImage(request, author, path);
    const [post] = await (await addPost(request, author, { image_path: path })).json();

    await request.delete(`${API}/rest/v1/posts?id=eq.${post.id}`, { headers: authHeaders(author) });

    // The row is gone, the file is not (the app removes it with the storage service, see the UI tests)
    expect(Number(runSql(`select count(*) from posts where id = ${post.id};`).trim())).toBe(0);
    expect((await request.get(publicPostImageUrl(path))).ok()).toBe(true);
  });
});
