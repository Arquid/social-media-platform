import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { API, createUser, authHeaders, runSql } from './api';
import { newUser, signUp, createPost, postCard } from './helpers';

// Every page is checked with axe-core (the same rules as the browser extension of Deque), in the
// light and the dark theme. Besides the WCAG 2.0 / 2.1 level A and AA rules the "best practice"
// rules are on: they include the page landmarks and a first level heading on every page.

const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

// A short readable list of what is wrong on the page right now
async function problemsOn(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(RULES).analyze();
  return violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const scheme of ['light', 'dark']) {
  test.describe(`accessibility, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('pages for visitors who are not logged in', async ({ page }) => {
      for (const path of ['/login', '/register', '/forgot-password', '/reset-password', '/no-such-page']) {
        await page.goto(path);
        await expect(page.locator('h1')).toHaveCount(1);
        expect(await problemsOn(page), path).toEqual([]);
      }
    });

    test('pages for a logged-in user', async ({ page, request }) => {
      // A user with a post, and a second user who likes it, so that there is a notification
      const user = newUser('a11y');
      await signUp(page, user);
      const text = `accessibility post ${user.username}`;
      await createPost(page, text);
      const postId = Number(runSql(`select id from posts where content = '${text}';`).trim());
      const fan = await createUser(request, 'a11yfan');
      await request.post(`${API}/rest/v1/likes`, {
        headers: authHeaders(fan, { 'Content-Type': 'application/json' }),
        data: { post_id: postId, user_id: fan.id },
      });

      // Home, with a post and the unread notification in the navigation bar
      await page.goto('/');
      await expect(postCard(page, text)).toBeVisible();
      await expect(page.locator('a[href="/notifications"]')).toHaveAttribute('aria-label', 'Notifications, 1 unread');
      await expect(page.locator('h1')).toHaveCount(1);
      expect(await problemsOn(page), 'home').toEqual([]);

      // Following tab (empty)
      await page.getByRole('tab', { name: 'Following' }).click();
      await expect(page.getByText('No posts yet.')).toBeVisible();
      expect(await problemsOn(page), 'following tab').toEqual([]);

      // Notifications
      await page.goto('/notifications');
      await expect(page.getByText(/liked your post/)).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      expect(await problemsOn(page), 'notifications').toEqual([]);

      // The post page, with its comments open
      await page.goto(`/post/${postId}`);
      await expect(page.getByText(text)).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      expect(await problemsOn(page), 'post page').toEqual([]);

      // Search with a result
      await page.goto(`/search?q=${fan.username}`);
      await expect(page.getByText(`@${fan.username}`).first()).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      expect(await problemsOn(page), 'search').toEqual([]);

      // Own profile and somebody else's
      await page.goto(`/profile/${user.username}`);
      await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      expect(await problemsOn(page), 'own profile').toEqual([]);

      await page.goto(`/profile/${fan.username}`);
      await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      expect(await problemsOn(page), 'profile of another user').toEqual([]);

      // The dialog for editing the own profile, once its opening animation has ended
      await page.goto(`/profile/${user.username}`);
      await page.getByRole('button', { name: 'Edit profile' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.locator('.MuiDialog-paper')).toHaveCSS('opacity', '1');
      await expect(page.locator('.MuiDialog-paper')).toHaveCSS('transform', 'none');
      // (the buttons still fade a little after the dialog has opened: look again until it is calm)
      await expect.poll(() => problemsOn(page), { message: 'edit profile dialog' }).toEqual([]);
    });
  });
}

test.describe('the structure of the pages', () => {
  test('every page has the main area and a navigation, and the file picker is not a nested button', async ({ page }) => {
    const user = newUser('struct');
    await signUp(page, user);

    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    await page.goto(`/profile/${user.username}`);
    await page.getByRole('button', { name: 'Edit profile' }).click();
    // "Change photo" is a label around a file input, not a button inside which another control sits
    await expect(page.getByText('Change photo')).toBeVisible();
    await expect(page.locator('label[role="button"]')).toHaveCount(0);
  });

  test('the notification link tells the number of unread notifications, and none when there are none', async ({ page }) => {
    await signUp(page, newUser('badge'));

    const bell = page.locator('a[href="/notifications"]');
    await expect(bell).toHaveAttribute('aria-label', 'Notifications');
    await expect(bell.locator('.MuiBadge-badge')).toBeHidden();
    await expect(bell).toHaveText('');
  });
});
